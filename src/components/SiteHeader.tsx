import { Menu, UserRound } from "lucide-react";
import { useState } from "react";
import { NavLink } from "react-router-dom";
import { PacketLogo } from "./PacketLogo";

const navigation = [
  { label: "Explore", to: "/explore" },
  { label: "Investigations", to: "/investigations" },
  { label: "Documentation", to: "/docs" },
  { label: "Saved journeys", to: "/saved" },
];

export function SiteHeader() {
  const [open, setOpen] = useState(false);

  return (
    <header className="site-header">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <div className="site-header__inner">
        <PacketLogo />
        <button
          className="icon-button site-header__menu"
          type="button"
          aria-expanded={open}
          aria-controls="primary-navigation"
          aria-label="Toggle navigation"
          onClick={() => setOpen((value) => !value)}
        >
          <Menu size={18} />
        </button>
        <nav
          id="primary-navigation"
          className={`site-nav${open ? " site-nav--open" : ""}`}
          aria-label="Primary navigation"
        >
          {navigation.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => (isActive ? "active" : undefined)}
              onClick={() => setOpen(false)}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <button
          className="user-button"
          type="button"
          aria-label="Anonymous browser installation"
          title="Saved history belongs to this browser installation; no account is signed in."
        >
          <UserRound size={15} />
          <span>Local</span>
        </button>
      </div>
    </header>
  );
}
