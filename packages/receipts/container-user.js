// Unix bind mounts retain host ownership. Windows uses the image's default user.
export function containerUserArgs(host = process) {
  if (typeof host.getuid !== 'function' || typeof host.getgid !== 'function') return [];
  const uid = host.getuid(), gid = host.getgid();
  if (!Number.isSafeInteger(uid) || uid < 0 || !Number.isSafeInteger(gid) || gid < 0) {
    throw new Error('Invalid host user identity');
  }
  return ['--user', `${uid}:${gid}`];
}
