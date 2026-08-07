import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Eye, EyeOff, Mail, Lock, User } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { supabase } from "@/integrations/supabase/client";
import { AuthShell, PrimaryButton, fieldClasses } from "@/components/auth/AuthShell";

export const Route = createFileRoute("/register")({
  head: () => ({
    meta: [
      { title: "Create account — MF SMC Trader" },
      { name: "description", content: "Create your MF SMC Trader account." },
      { property: "og:title", content: "Create account — MF SMC Trader" },
      { property: "og:description", content: "Create your MF SMC Trader account." },
    ],
  }),
  component: RegisterPage,
});

const schema = z
  .object({
    fullName: z.string().trim().min(2, "Enter your full name").max(120),
    email: z.string().trim().email("Enter a valid email"),
    password: z.string().min(6, "Password must be at least 6 characters"),
    confirm: z.string(),
  })
  .refine((d) => d.password === d.confirm, {
    path: ["confirm"],
    message: "Passwords do not match",
  });

type FormErrors = Partial<Record<"fullName" | "email" | "password" | "confirm", string>>;

function RegisterPage() {
  const navigate = useNavigate();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = schema.safeParse({ fullName, email, password, confirm });
    if (!parsed.success) {
      const fe: FormErrors = {};
      for (const issue of parsed.error.issues) {
        fe[issue.path[0] as keyof FormErrors] = issue.message;
      }
      setErrors(fe);
      return;
    }
    setErrors({});
    setLoading(true);
    const normalizedEmail = parsed.data.email.trim().toLowerCase();
    try {
      const { data, error } = await supabase.auth.signUp({
        email: normalizedEmail,
        password: parsed.data.password,
        options: {
          emailRedirectTo: window.location.origin + "/login",
          data: { full_name: parsed.data.fullName },
        },
      });
      if (error) throw error;

      toast.success("Account created! Please log in.", {
        style: { background: "#0c1a2e", color: "#67e8f9", border: "1px solid oklch(0.78 0.13 195 / 0.3)" },
      });
      navigate({ to: "/login" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Registration failed";
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="Join MF SMC Trader in seconds."
      footer={
        <>
          Already have an account?{" "}
          <Link to="/login" className="font-medium text-primary hover:underline">
            Log in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Full name</label>
          <div className="relative">
            <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              autoComplete="name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Jane Doe"
              className={fieldClasses(!!errors.fullName) + " pl-9"}
            />
          </div>
          {errors.fullName && <p className="mt-1 text-xs text-destructive">{errors.fullName}</p>}
        </div>

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
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 6 characters"
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

        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Confirm password</label>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type={show ? "text" : "password"}
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Re-enter password"
              className={fieldClasses(!!errors.confirm) + " pl-9"}
            />
          </div>
          {errors.confirm && <p className="mt-1 text-xs text-destructive">{errors.confirm}</p>}
        </div>

        <PrimaryButton type="submit" loading={loading}>
          {loading ? "Creating account…" : "Register"}
        </PrimaryButton>
      </form>
    </AuthShell>
  );
}
