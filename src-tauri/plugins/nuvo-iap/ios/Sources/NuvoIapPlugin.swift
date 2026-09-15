// StoreKit bridge. Compiled by cargo (swift-rs) into libapp.a.
//
// Products load through StoreKit 1 (SKProductsRequest — delegate, proven on
// TestFlight). Purchase and restore run on StoreKit 2: `Product.purchase()`
// hands its result straight back to this call. The StoreKit 1 version waited
// on an SKPaymentTransactionObserver that never answered on the iPad, and the
// paywall sat on "Working…" with no sheet and no error.
//
// Swift concurrency here is safe: Dayspring ships the same StoreKit 2 calls on
// the identical toolchain (tauri 2.11.2, swift-rs 1.0.7, iOS 15 floor) and its
// purchase sheet works on device. Re-check that before lowering the floor.
//
// Product identifiers arrive from JS (env / catalog). Localized prices come
// from StoreKit — this file never invents a dollar amount.

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
    /// StoreKit subscription period, localized. Empty if the product has none.
    let duration: String
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
    /// Expiry in epoch milliseconds, when StoreKit knows it.
    let expiresDate: Int64?
}

struct RestorePayload: Encodable {
    let supported: Bool
    let transactions: [PurchasePayload]
}

private func isStoreKitProductId(_ id: String) -> Bool {
    // StoreKit Product ID strings only — never empty, never an all-digit Apple internal ID.
    !id.isEmpty && id.range(of: "^[0-9]+$", options: .regularExpression) == nil
}

@available(iOS 15.0, *)
private func payload(for transaction: Transaction) -> PurchasePayload {
    PurchasePayload(
        productId: transaction.productID,
        transactionId: String(transaction.id),
        originalTransactionId: String(transaction.originalID),
        expiresDate: transaction.expirationDate.map { Int64($0.timeIntervalSince1970 * 1000) }
    )
}

class NuvoIapPlugin: Plugin, SKProductsRequestDelegate {
    private var productsInvoke: Invoke?
    // SKProductsRequest's delegate is weak and StoreKit doesn't promise to keep
    // the request alive — hold it until it answers.
    private var pendingProductsRequest: SKProductsRequest?
    private let lock = NSLock()

    @objc public func products(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(ProductIdsArgs.self)
        let ids = Set(args.productIds.filter(isStoreKitProductId))
        guard !ids.isEmpty else {
            return invoke.resolve(ProductsPayload(supported: true, products: [], invalidIds: []))
        }
        lock.lock()
        productsInvoke = invoke
        lock.unlock()
        let request = SKProductsRequest(productIdentifiers: ids)
        request.delegate = self
        pendingProductsRequest = request
        request.start()
    }

    @objc public func purchase(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(ProductIdArgs.self)
        guard isStoreKitProductId(args.productId) else {
            return invoke.reject("Unknown App Store product")
        }
        guard AppStore.canMakePayments else {
            return invoke.reject("Purchases are not allowed on this Apple ID")
        }
        Task {
            do {
                guard let product = try await Product.products(for: [args.productId]).first else {
                    invoke.reject("Unknown App Store product")
                    return
                }
                switch try await product.purchase() {
                case .success(let verification):
                    guard case .verified(let transaction) = verification else {
                        invoke.reject("The App Store couldn’t verify that purchase")
                        return
                    }
                    let result = payload(for: transaction)
                    await transaction.finish()
                    invoke.resolve(result)
                case .userCancelled:
                    invoke.reject("Purchase cancelled")
                case .pending:
                    invoke.reject("Purchase is waiting for approval")
                @unknown default:
                    invoke.reject("Purchase didn’t complete")
                }
            } catch {
                invoke.reject(error.localizedDescription)
            }
        }
    }

    @objc public func restore(_ invoke: Invoke) {
        Task {
            // User-initiated: sync with the App Store so a fresh install picks up
            // existing transactions. A dismissed sign-in still falls back to local.
            try? await AppStore.sync()
            var transactions: [PurchasePayload] = []
            for await entitlement in Transaction.currentEntitlements {
                if case .verified(let transaction) = entitlement {
                    transactions.append(payload(for: transaction))
                }
            }
            invoke.resolve(RestorePayload(supported: true, transactions: transactions))
        }
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
            formatter.locale = product.priceLocale
            let price = formatter.string(from: product.price) ?? ""
            payloads.append(IapProductPayload(
                id: product.productIdentifier,
                displayName: product.localizedTitle,
                description: product.localizedDescription,
                displayPrice: price,
                duration: durationLabel(for: product)
            ))
        }
        lock.lock()
        let invoke = productsInvoke
        productsInvoke = nil
        pendingProductsRequest = nil
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
        pendingProductsRequest = nil
        lock.unlock()
        invoke?.reject(error.localizedDescription)
    }

    /// Title, duration, and price come from StoreKit — never invented here.
    private func durationLabel(for product: SKProduct) -> String {
        guard let period = product.subscriptionPeriod else { return "" }
        var comps = DateComponents()
        switch period.unit {
        case .day: comps.day = period.numberOfUnits
        case .week: comps.weekOfMonth = period.numberOfUnits
        case .month: comps.month = period.numberOfUnits
        case .year: comps.year = period.numberOfUnits
        @unknown default: return ""
        }
        let fmt = DateComponentsFormatter()
        fmt.allowedUnits = [.day, .weekOfMonth, .month, .year]
        fmt.unitsStyle = .full
        fmt.maximumUnitCount = 1
        fmt.calendar = product.priceLocale.calendar
        return fmt.string(from: comps) ?? ""
    }
}

@_cdecl("init_plugin_nuvo_iap")
func initPlugin() -> Plugin {
    NuvoIapPlugin()
}
