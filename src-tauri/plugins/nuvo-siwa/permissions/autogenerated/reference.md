## Default Permission

Default permissions for the nuvo-siwa plugin.

Grants the one Sign in with Apple command. These are Tauri IPC permissions for
the app's own webview. Nothing here is reachable from remote content, and the
plugin never returns a Supabase session — only Apple's identity token, which
is useless without the project's own verification.

#### This default permission set includes the following:

- `allow-sign-in`

## Permission Table

<table>
<tr>
<th>Identifier</th>
<th>Description</th>
</tr>


<tr>
<td>

`nuvo-siwa:allow-sign-in`

</td>
<td>

Enables the sign_in command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`nuvo-siwa:deny-sign-in`

</td>
<td>

Denies the sign_in command without any pre-configured scope.

</td>
</tr>
</table>
