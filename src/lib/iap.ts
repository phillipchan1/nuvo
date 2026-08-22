// StoreKit bridge for the iOS App Store binary. Product identifiers come
// from env / iap-catalog — never prices. Localized price strings exist only
// on StoreKit product objects the native plugin returns.
import { supabase } from "./supabase";

export type IapProduct = {
  id: string;
  displayName: string;
  description: string;
  /** StoreKit's localized price string. Empty if the product didn't load. */
  displayPrice: string;
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
  const monthly = (import.meta.env.VITE_NUVO_IAP_MONTHLY as string | undefined)?.trim() || null;
  const annual = (import.meta.env.VITE_NUVO_IAP_ANNUAL as string | undefined)?.trim() || null;
  return { monthly, annual };
}

export async function fetchIapCatalog(): Promise<IapCatalog> {
  const fromEnv = catalogFromEnv();
  if (fromEnv.monthly || fromEnv.annual) return fromEnv;
  const { data, error } = await supabase.functions.invoke<IapCatalog>("iap-catalog", { body: {} });
  if (error || !data) return { monthly: null, annual: null };
  return {
    monthly: data.monthly?.trim() || null,
    annual: data.annual?.trim() || null,
  };
}

export function catalogProductIds(catalog: IapCatalog): string[] {
  return [catalog.monthly, catalog.annual].filter((id): id is string => Boolean(id));
}

async function invokeIap<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(`plugin:nuvo-iap|${cmd}`, args);
}

export async function loadIapProducts(productIds: string[]): Promise<IapProduct[]> {
  if (productIds.length === 0) return [];
  try {
    const result = await invokeIap<{ products: IapProduct[]; supported?: boolean }>("products", {
      productIds,
    });
    return Array.isArray(result?.products) ? result.products : [];
  } catch {
    return [];
  }
}

export async function purchaseIap(productId: string): Promise<IapPurchase> {
  return invokeIap<IapPurchase>("purchase", { productId });
}

export async function restoreIap(): Promise<IapPurchase[]> {
  const result = await invokeIap<{ transactions?: IapPurchase[] }>("restore");
  return Array.isArray(result?.transactions) ? result.transactions : [];
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
