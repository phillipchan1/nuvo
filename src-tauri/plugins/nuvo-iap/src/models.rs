use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductIds {
    pub product_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductId {
    pub product_id: String,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IapProduct {
    pub id: String,
    pub display_name: String,
    pub description: String,
    /// StoreKit localized price. Never invented in JS.
    pub display_price: String,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductsResult {
    pub supported: bool,
    pub products: Vec<IapProduct>,
    #[serde(default)]
    pub invalid_ids: Vec<String>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IapPurchase {
    pub product_id: String,
    pub transaction_id: Option<String>,
    pub original_transaction_id: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreResult {
    pub supported: bool,
    pub transactions: Vec<IapPurchase>,
}
