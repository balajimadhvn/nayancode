import { forwardRef } from 'react';
import { Link as RouterLink, NavLink as RouterNavLink, type LinkProps, type NavLinkProps } from 'react-router-dom';

/** Router links with a trailing slash, matching the prerendered route folders (GitHub Pages serves /path/ directly). */
export function slash(to: string): string {
  if (!to.startsWith('/')) return to;
  const m = /^([^?#]*)(.*)$/.exec(to)!;
  let p = m[1];
  if (p !== '/' && !p.endsWith('/') && !/\.[a-z0-9]{2,5}$/i.test(p)) p += '/';
  return p + m[2];
}
export const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link({ to, ...rest }, ref) {
  return <RouterLink ref={ref} to={typeof to === 'string' ? slash(to) : to} {...rest} />;
});
export const NavLink = forwardRef<HTMLAnchorElement, NavLinkProps>(function NavLink({ to, ...rest }, ref) {
  return <RouterNavLink ref={ref} to={typeof to === 'string' ? slash(to) : to} {...rest} />;
});
