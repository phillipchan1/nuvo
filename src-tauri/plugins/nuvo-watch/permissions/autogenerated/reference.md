## Default Permission

Default permissions for the nuvo-watch plugin.

Grants the three credential-bridge commands. These are Tauri IPC permissions:
they let the app's own webview ask the native side to hand a paired Apple Watch
a credential. Nothing here is reachable from remote content, and the payload is
a revocable connection token rather than the user's Supabase session.

#### This default permission set includes the following:

- `allow-push-session`
- `allow-clear-session`
- `allow-watch-status`

## Permission Table

<table>
<tr>
<th>Identifier</th>
<th>Description</th>
</tr>


<tr>
<td>

`nuvo-watch:allow-clear-session`

</td>
<td>

Enables the clear_session command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`nuvo-watch:deny-clear-session`

</td>
<td>

Denies the clear_session command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`nuvo-watch:allow-push-session`

</td>
<td>

Enables the push_session command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`nuvo-watch:deny-push-session`

</td>
<td>

Denies the push_session command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`nuvo-watch:allow-watch-status`

</td>
<td>

Enables the watch_status command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`nuvo-watch:deny-watch-status`

</td>
<td>

Denies the watch_status command without any pre-configured scope.

</td>
</tr>
</table>
