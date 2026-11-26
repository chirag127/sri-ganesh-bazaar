// Push delivery is not wired to the Neon worker yet. Do not register device
// tokens that the migrated backend cannot reliably revoke or deliver to.
export async function requestPush(): Promise<void> {
  throw new Error('Push notifications are unavailable during the Neon migration. Check your order history for updates.');
}
export async function unregisterPush(): Promise<void> {
  // No Neon push registrations are created by this client.
}
