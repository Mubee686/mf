import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="auth-bg min-h-screen w-full flex items-center justify-center px-4 py-10">
      <div className="auth-blob h-72 w-72 bg-primary left-[-4rem] top-[-4rem]" />
      <div
        className="auth-blob h-80 w-80 bg-primary right-[-6rem] top-1/3"
        style={{ animationDelay: "3s" }}
      />
      <div
        className="auth-blob h-64 w-64 bg-primary left-1/3 bottom-[-4rem]"
        style={{ animationDelay: "6s" }}
      />

      <div className="auth-fade-up relative z-10 w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-[0_25px_60px_-20px_oklch(0.78_0.13_195/0.18)] backdrop-blur-xl">
        <Link to="/" className="mb-6 flex items-center gap-2">
          <img src="/logo.png" alt="MF SMC Logo" className="h-9 w-9 rounded-lg object-cover" />
          <span className="text-sm font-semibold tracking-tight text-foreground">MF SMC Trader</span>
        </Link>

        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>

        <div className="mt-6 flex rounded-lg bg-secondary p-1 text-sm font-medium">
          <Link
            to="/login"
            className="flex-1 rounded-md px-3 py-2 text-center transition-colors text-muted-foreground hover:text-foreground [&.active]:bg-accent [&.active]:text-foreground [&.active]:shadow-sm"
            activeProps={{ className: "active" }}
          >
            Log in
          </Link>
          <Link
            to="/register"
            className="flex-1 rounded-md px-3 py-2 text-center transition-colors text-muted-foreground hover:text-foreground [&.active]:bg-accent [&.active]:text-foreground [&.active]:shadow-sm"
            activeProps={{ className: "active" }}
          >
            Register
          </Link>
        </div>

        <div className="mt-6 auth-tab-switch">{children}</div>

        <div className="mt-6 text-center text-sm text-muted-foreground">{footer}</div>
      </div>
    </div>
  );
}

export function fieldClasses(hasError: boolean) {
  return [
    "w-full rounded-lg border bg-secondary px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground outline-none transition",
    "focus:border-primary focus:ring-4 focus:ring-primary/10",
    hasError ? "border-destructive field-shake" : "border-border",
  ].join(" ");
}

export function PrimaryButton({
  children,
  loading,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) {
  return (
    <button
      {...props}
      disabled={loading || props.disabled}
      className={
        "btn-glow w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-md disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2 " +
        (props.className ?? "")
      }
    >
      {loading && (
        <svg
          className="h-4 w-4 animate-spin"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
          <path
            d="M22 12a10 10 0 0 1-10 10"
            stroke="currentColor"
            strokeWidth="4"
            strokeLinecap="round"
          />
        </svg>
      )}
      <span>{children}</span>
    </button>
  );
}
