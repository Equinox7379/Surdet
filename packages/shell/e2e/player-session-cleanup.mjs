/** Include shutdown errors in the same result as the player actions. */
export async function closePlayerSession(app, events) {
  const failures = [];
  events.intentionalClose = true;
  try {
    await app.close();
  } catch (error) {
    failures.push(`Electron close failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  }
  // Console/page events emitted during close must also affect the final verdict.
  for (const [channel, entries] of Object.entries(events)) {
    if (Array.isArray(entries) && entries.length > 0) {
      failures.push(`${channel}: ${JSON.stringify(entries)}`);
    }
  }
  if (events.unexpectedWindowClosed) failures.push('窗口在预期关闭前已经意外关闭。');
  return failures;
}
