export function getDisplayFirstName(options: {
  profileName?: string | null;
  authDisplayName?: string | null;
  email?: string | null;
}) {
  const rawName = options.profileName?.trim() || options.authDisplayName?.trim();
  if (rawName) {
    const [firstName] = rawName.split(/\s+/);
    return firstName;
  }

  const email = options.email?.trim();
  if (email) {
    return email.split('@')[0];
  }

  return 'Atleta';
}
