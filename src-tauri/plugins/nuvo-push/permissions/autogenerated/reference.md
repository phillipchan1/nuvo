## Default Permission

Default permissions for the nuvo-push plugin.

Lets the app's own webview ask iOS for this device's APNs token, so the reminder
dispatcher can reach the phone while Nuvo is closed. The token is only an
address; what may be sent to it is decided server-side by reminderRules.ts.

#### This default permission set includes the following:

- `allow-register`

## Permission Table

<table>
<tr>
<th>Identifier</th>
<th>Description</th>
</tr>


<tr>
<td>

`nuvo-push:allow-register`

</td>
<td>

Enables the register command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`nuvo-push:deny-register`

</td>
<td>

Denies the register command without any pre-configured scope.

</td>
</tr>
</table>
