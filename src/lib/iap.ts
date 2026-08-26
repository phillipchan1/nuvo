// StoreKit bridge for the iOS App Store binary. Product identifiers are the
// Connect strings NUVO_IAP_MONTHLY / NUVO_IAP_ANNUAL — never Apple internal
// IDs, never prices. Localized price strings exist only on StoreKit product
// objects the native plugin returns.
import { supabase } from "./supabase";
import {
  configuredIapProductIds,
  storeKitProductIds,
} from "../../supabase/functions/_shared/planRules.ts";

export type IapProduct = {
  id: string;
  displayName: string;
  description: string;
  /** StoreKit's localized price string. Empty if the product didn't load. */
  displayPrice: string;
  /** StoreKit subscription period (localized). Empty if the product has none. */
  duration: string;
};

export type IapCatalog = {
  monthly: string | null;
  annual: string | null;
};

export type IapPurchase = {
  productId: string;
  transactionId: string | null;
  originalTransactionId: string | null;
};

function catalogFromEnv(): IapCatalog {
  return configuredIapProductIds({
    NUVO_IAP_MONTHLY: import.meta.env.VITE_NUVO_IAP_MONTHLY,
    NUVO_IAP_ANNUAL: import.meta.env.VITE_NUVO_IAP_ANNUAL,
  });
}

export async function fetchIapCatalog(): Promise<IapCatalog> {
  return catalogFromEnv();
}

export function catalogProductIds(catalog: IapCatalog): string[] {
  return storeKitProductIds([catalog.monthly, catalog.annual].filter((id): id is string => Boolean(id)));
}

async function invokeIap<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(`plugin:nuvo-iap|${cmd}`, args);
}

export async function loadIapProducts(productIds: string[]): Promise<IapProduct[]> {
  const ids = storeKitProductIds(productIds);
  if (ids.length === 0) return [];
  try {
    const result = await invokeIap<{ products: IapProduct[]; supported?: boolean }>("products", {
      productIds: ids,
    });
    return Array.isArray(result?.products)
      ? result.products.map((p) => ({
          ...p,
          displayPrice: p.displayPrice ?? "",
          duration: p.duration ?? "",
        }))
      : [];
  } catch {
    return [];
  }
}

export async function purchaseIap(productId: string): Promise<IapPurchase> {
  const [id] = storeKitProductIds([productId]);
  if (!id) throw new Error("Unknown App Store product");
  return invokeIap<IapPurchase>("purchase", { productId: id });
}

export async function restoreIap(): Promise<IapPurchase[]> {
  const result = await invokeIap<{ transactions?: IapPurchase[] }>("restore");
  return Array.isArray(result?.transactions) ? result.transactions : [];
}

/** Restore → confirm the matching Apple transaction on the one entitlement row. */
export async function restoreAndConfirm(): Promise<void> {
  const txs = await restoreIap();
  const ok = txs.find((t) => t.originalTransactionId && t.productId);
  if (!ok) throw new Error("No subscription to restore on this Apple ID");
  await confirmApplePurchase(ok);
}

export async function manageIapSubscriptions(): Promise<void> {
  await invokeIap("manage_subscriptions");
}

/** Tell the one entitlement row this Apple transaction belongs to us. */
export async function confirmApplePurchase(purchase: IapPurchase): Promise<void> {
  if (!purchase.originalTransactionId || !purchase.productId) {
    throw new Error("That App Store purchase is missing its transaction.");
  }
  const { error } = await supabase.functions.invoke("apple-iap", {
    body: {
      productId: purchase.productId,
      transactionId: purchase.transactionId,
      originalTransactionId: purchase.originalTransactionId,
    },
  });
  if (error) throw new Error(error.message ?? "Could not confirm the App Store purchase");
}
