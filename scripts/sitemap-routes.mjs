const privateDashboardRoots = ['/gestion', '/en/manage'];

export function isPrivateDashboardRoute(page) {
  const pathname = new URL(page).pathname.replace(/\/$/, '');
  return privateDashboardRoots.some(
    (root) => pathname === root || pathname.startsWith(`${root}/`),
  );
}