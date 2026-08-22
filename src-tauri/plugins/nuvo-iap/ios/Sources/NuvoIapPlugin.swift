// StoreKit 1 bridge. Compiled by cargo (swift-rs) into libapp.a.
//
// Delegate-based on purpose: no async/await, no Task. Product identifiers
// arrive from JS (env / catalog). Localized prices come from SKProduct —
// this file never invents a dollar amount.

import Foundation
import StoreKit
import Tauri
import UIKit
import WebKit

class ProductIdsArgs: Decodable {
    let productIds: [String]
}

class ProductIdArgs: Decodable {
    let productId: String
}

struct IapProductPayload: Encodable {
    let id: String
    let displayName: String
    let description: String
    let displayPrice: String
}

struct ProductsPayload: Encodable {
    let supported: Bool
    let products: [IapProductPayload]
    let invalidIds: [String]
}

struct PurchasePayload: Encodable {
    let productId: String
    let transactionId: String?
    let originalTransactionId: String?
}

struct RestorePayload: Encodable {
    let supported: Bool
    let transactions: [PurchasePayload]
}

class NuvoIapPlugin: Plugin, SKProductsRequestDelegate, SKPaymentTransactionObserver {
    private var cached: [String: SKProduct] = [:]
    private var productsInvoke: Invoke?
    private var purchaseInvoke: Invoke?
    private var restoreInvoke: Invoke?
    private var restored: [PurchasePayload] = []
    private let lock = NSLock()

    public override func load(webview: WKWebView) {
        SKPaymentQueue.default().add(self)
    }

    @objc public func products(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(ProductIdsArgs.self)
        let ids = Set(args.productIds.filter { !$0.isEmpty })
        guard !ids.isEmpty else {
            return invoke.resolve(ProductsPayload(supported: true, products: [], invalidIds: []))
        }
        lock.lock()
        productsInvoke = invoke
        lock.unlock()
        let request = SKProductsRequest(productIdentifiers: ids)
        request.delegate = self
        request.start()
    }

    @objc public func purchase(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(ProductIdArgs.self)
        guard SKPaymentQueue.canMakePayments() else {
            return invoke.reject("Purchases are not allowed on this Apple ID")
        }
        guard let product = cached[args.productId] else {
            return invoke.reject("Unknown App Store product — load products first")
        }
        lock.lock()
        purchaseInvoke = invoke
        lock.unlock()
        SKPaymentQueue.default().add(SKPayment(product: product))
    }

    @objc public func restore(_ invoke: Invoke) {
        lock.lock()
        restoreInvoke = invoke
        restored = []
        lock.unlock()
        SKPaymentQueue.default().restoreCompletedTransactions()
    }

    @objc public func manageSubscriptions(_ invoke: Invoke) {
        guard let url = URL(string: "https://apps.apple.com/account/subscriptions") else {
            return invoke.reject("Could not open subscription settings")
        }
        DispatchQueue.main.async {
            UIApplication.shared.open(url, options: [:]) { ok in
                if ok { invoke.resolve() }
                else { invoke.reject("Could not open subscription settings") }
            }
        }
    }

    func productsRequest(_ request: SKProductsRequest, didReceive response: SKProductsResponse) {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        var payloads: [IapProductPayload] = []
        for product in response.products {
            cached[product.productIdentifier] = product
            formatter.locale = product.priceLocale
            let price = formatter.string(from: product.price) ?? ""
            payloads.append(IapProductPayload(
                id: product.productIdentifier,
                displayName: product.localizedTitle,
                description: product.localizedDescription,
                displayPrice: price
            ))
        }
        lock.lock()
        let invoke = productsInvoke
        productsInvoke = nil
        lock.unlock()
        invoke?.resolve(ProductsPayload(
            supported: true,
            products: payloads,
            invalidIds: response.invalidProductIdentifiers
        ))
    }

    func request(_ request: SKRequest, didFailWithError error: Error) {
        lock.lock()
        let invoke = productsInvoke
        productsInvoke = nil
        lock.unlock()
        invoke?.reject(error.localizedDescription)
    }

    func paymentQueue(_ queue: SKPaymentQueue, updatedTransactions transactions: [SKPaymentTransaction]) {
        for tx in transactions {
            switch tx.transactionState {
            case .purchased, .restored:
                let payload = PurchasePayload(
                    productId: tx.payment.productIdentifier,
                    transactionId: tx.transactionIdentifier,
                    originalTransactionId: tx.original?.transactionIdentifier ?? tx.transactionIdentifier
                )
                queue.finishTransaction(tx)
                if tx.transactionState == .restored {
                    lock.lock()
                    restored.append(payload)
                    lock.unlock()
                } else {
                    lock.lock()
                    let invoke = purchaseInvoke
                    purchaseInvoke = nil
                    lock.unlock()
                    invoke?.resolve(payload)
                }
            case .failed:
                queue.finishTransaction(tx)
                lock.lock()
                let invoke = purchaseInvoke
                purchaseInvoke = nil
                lock.unlock()
                let msg = tx.error?.localizedDescription ?? "Purchase failed"
                invoke?.reject(msg)
            case .purchasing, .deferred:
                break
            @unknown default:
                break
            }
        }
    }

    func paymentQueueRestoreCompletedTransactionsFinished(_ queue: SKPaymentQueue) {
        lock.lock()
        let invoke = restoreInvoke
        restoreInvoke = nil
        let txs = restored
        restored = []
        lock.unlock()
        invoke?.resolve(RestorePayload(supported: true, transactions: txs))
    }

    func paymentQueue(_ queue: SKPaymentQueue, restoreCompletedTransactionsFailedWithError error: Error) {
        lock.lock()
        let invoke = restoreInvoke
        restoreInvoke = nil
        restored = []
        lock.unlock()
        invoke?.reject(error.localizedDescription)
    }
}

@_cdecl("init_plugin_nuvo_iap")
func initPlugin() -> Plugin {
    NuvoIapPlugin()
}
