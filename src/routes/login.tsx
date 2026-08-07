import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Eye, EyeOff, Mail, Lock } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { supabase } from "@/integrations/supabase/client";
import { AuthShell, PrimaryButton, fieldClasses } from "@/components/auth/AuthShell";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Log in — MF SMC Trader" },
      { name: "description", content: "Sign in to your MF SMC Trader account." },
      { property: "og:title", content: "Log in — MF SMC Trader" },
      { property: "og:description", content: "Sign in to your MF SMC Trader account." },
    ],
  }),
  component: LoginPage,
});

const schema = z.object({
  email: z.string().trim().email("Enter a valid email"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = schema.safeParse({ email, password });
    if (!parsed.success) {
      const fe: typeof errors = {};
      for (const issue of parsed.error.issues) {
        fe[issue.path[0] as "email" | "password"] = issue.message;
      }
      setErrors(fe);
      return;
    }
    setErrors({});
    setLoading(true);
    const normalizedEmail = parsed.data.email.trim().toLowerCase();
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password: parsed.data.password,
      });

      if (error) throw error;

      toast.success("Login Successful", {
        className: "toast-bounce-in",
        style: { background: "#0c1a2e", color: "#67e8f9", border: "1px solid oklch(0.78 0.13 195 / 0.3)" },
      });
      setSuccess(true);
      setTimeout(() => navigate({ to: "/dashboard" }), 380);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Login failed";
      toast.error(message);
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Log in to continue to your MF SMC Trader dashboard."
      footer={
        <>
          New here?{" "}
          <Link to="/register" className="font-medium text-primary hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <form
        onSubmit={onSubmit}
        noValidate
        className={
          "space-y-4 transition-all duration-300 ease-out " +
          (success ? "pointer-events-none translate-y-1 scale-[0.98] opacity-0" : "opacity-100")
        }
      >
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Email</label>
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className={fieldClasses(!!errors.email) + " pl-9"}
            />
          </div>
          {errors.email && <p className="mt-1 text-xs text-destructive">{errors.email}</p>}
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Password</label>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type={show ? "text" : "password"}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className={fieldClasses(!!errors.password) + " pl-9 pr-10"}
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              aria-label={show ? "Hide password" : "Show password"}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-primary"
            >
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {errors.password && <p className="mt-1 text-xs text-destructive">{errors.password}</p>}
        </div>

        <div className="flex items-center justify-end text-sm">
          <button
            type="button"
            onClick={async () => {
              if (!email) return toast.error("Enter your email first");
              const { error } = await supabase.auth.resetPasswordForEmail(email, {
                redirectTo: window.location.origin + "/login",
              });
              if (error) toast.error(error.message);
              else toast.success("Password reset email sent");
            }}
            className="font-medium text-primary hover:underline"
          >
            Forgot password?
          </button>
        </div>

        <PrimaryButton type="submit" loading={loading}>
          {loading ? "Signing in…" : "Log in"}
        </PrimaryButton>
      </form>
    </AuthShell>
  );
}
