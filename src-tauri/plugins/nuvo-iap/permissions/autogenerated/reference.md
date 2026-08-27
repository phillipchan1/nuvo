## Default Permission

Default permissions for the nuvo-iap plugin.

Grants StoreKit product / purchase / restore / manage commands. These are
Tauri IPC permissions for the app's own webview. Nothing here is reachable
from remote content.

#### This default permission set includes the following:

- `allow-products`
- `allow-purchase`
- `allow-restore`
- `allow-manage-subscriptions`

## Permission Table

<table>
<tr>
<th>Identifier</th>
<th>Description</th>
</tr>


<tr>
<td>

`nuvo-iap:allow-manage-subscriptions`

</td>
<td>

Enables the manage_subscriptions command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`nuvo-iap:deny-manage-subscriptions`

</td>
<td>

Denies the manage_subscriptions command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`nuvo-iap:allow-products`

</td>
<td>

Enables the products command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`nuvo-iap:deny-products`

</td>
<td>

Denies the products command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`nuvo-iap:allow-purchase`

</td>
<td>

Enables the purchase command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`nuvo-iap:deny-purchase`

</td>
<td>

Denies the purchase command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`nuvo-iap:allow-restore`

</td>
<td>

Enables the restore command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`nuvo-iap:deny-restore`

</td>
<td>

Denies the restore command without any pre-configured scope.

</td>
</tr>
</table>
