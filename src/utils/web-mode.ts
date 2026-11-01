/** Whether Dexter runs behind the multi-user web backend (which sets DEXTER_WEB_MODE=1). */
export function isWebMode(env: Record<string, string | undefined> = process.env): boolean {
  return env.DEXTER_WEB_MODE === '1';
}
