export function Header() {
  return (
    <header>
      <nav>
        <a className="brand" href="/" aria-label="Switchboard home">
          <svg viewBox="0 0 30 30" fill="none" aria-hidden="true">
            <path
              d="M7 7v16M7 15h16M23 7v16"
              stroke="currentColor"
              strokeWidth="2.5"
            />
            <circle cx="7" cy="7" r="3" fill="#c9f2d9" />
            <circle cx="23" cy="23" r="3" fill="#c9f2d9" />
            <circle cx="23" cy="7" r="3" fill="currentColor" />
            <circle cx="7" cy="23" r="3" fill="currentColor" />
          </svg>
          switchboard
        </a>
        <span className="nav-note">
          <span className="dot" />
          Your call. Our legwork.
        </span>
      </nav>
    </header>
  );
}
