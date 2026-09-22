export default async function teardown(): Promise<void> {
  // Close the loopback-only test server cleanly on Windows as well as CI Linux.
  try { await fetch('http://127.0.0.1:4173/__test_shutdown', { method: 'POST', signal: AbortSignal.timeout(5000) }); }
  catch { /* The test runner will clean up a server that already exited. */ }
}
