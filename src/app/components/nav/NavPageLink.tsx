import React from 'react';
import { Avatar, Box, Icon, Text, type IconSrc } from 'folds';
import { NavItem, NavItemContent, NavLink } from './NavItem';

type NavPageLinkProps = {
  to: string;
  icon: IconSrc;
  label: string;
  selected: boolean;
};

/** A navigation row that opens one of the section's own pages (Invites, Featured, a server). */
export function NavPageLink({ to, icon, label, selected }: NavPageLinkProps) {
  return (
    <NavItem variant="Background" radii="400" aria-selected={selected}>
      <NavLink to={to} aria-current={selected ? 'page' : undefined}>
        <NavItemContent>
          <Box as="span" grow="Yes" gap="200" alignItems="Center">
            <Avatar size="200" radii="400">
              <Icon src={icon} size="100" filled={selected} />
            </Avatar>
            <Text as="span" size="Inherit" truncate>
              {label}
            </Text>
          </Box>
        </NavItemContent>
      </NavLink>
    </NavItem>
  );
}
