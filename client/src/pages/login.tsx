import { useState } from "react";
import {
  MountainSnow,
  LogIn,
  Mail,
  Lock,
  User as UserIcon,
  Chrome,
} from "lucide-react";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  updateProfile,
} from "firebase/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { firebaseAuth, googleProvider } from "@/lib/firebase";
import { useToast } from "@/hooks/use-toast";

export function LoginPage() {
  const { toast } = useToast();
  const [isSignUp, setIsSignUp] = useState(false);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleGoogleSignIn = async () => {
    try {
      setIsLoading(true);
      await signInWithPopup(firebaseAuth, googleProvider);
    } catch (error: any) {
      if (error?.code !== 'auth/popup-closed-by-user') {
        toast({
          title: "Google sign-in failed",
          description: error?.message ?? "Please try again.",
          variant: "destructive",
        });
      }
      setIsLoading(false);
    }
  };

  const handleEmailAuth = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email || !password) return;

    try {
      setIsLoading(true);
      if (isSignUp) {
        const creds = await createUserWithEmailAndPassword(firebaseAuth, email, password);
        if (username.trim()) {
          await updateProfile(creds.user, { displayName: username.trim() });
        }
      } else {
        await signInWithEmailAndPassword(firebaseAuth, email, password);
      }
    } catch (error: any) {
      toast({
        title: isSignUp ? "Sign up failed" : "Sign in failed",
        description: error?.message ?? "Please check your credentials and try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6" data-testid="login-page">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[500px] h-[500px] rounded-full bg-gradient-primary opacity-[0.07] blur-[120px]" />
        <div className="absolute bottom-1/4 left-1/3 w-[300px] h-[300px] rounded-full bg-brand-accent opacity-[0.05] blur-[100px]" />
      </div>

      <div className="relative z-10 flex flex-col items-center gap-8 max-w-sm w-full">
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-gradient-primary flex items-center justify-center shadow-[0_0_30px_rgba(65,209,255,0.3)]">
            <MountainSnow size={32} className="text-brand-bg" />
          </div>
          <div className="flex items-center gap-1">
            <span className="text-3xl font-bold tracking-tight text-brand-text">Peak</span>
            <span className="text-3xl font-bold text-gradient-primary">Ready</span>
          </div>
          <p className="text-brand-muted text-sm text-center leading-relaxed">
            Your personal mountain bike training guide.
            Get back on the bike, build confidence, and ride consistently.
          </p>
        </div>

        <div className="glass-panel p-6 w-full flex flex-col gap-5">
          <div className="text-center">
            <h2 className="text-lg font-semibold text-brand-text mb-1">Welcome back</h2>
            <p className="text-brand-muted text-xs">
              Sign in with Google or email/password
            </p>
          </div>

          <Button
            type="button"
            size="lg"
            className="w-full bg-gradient-primary text-brand-bg font-semibold"
            onClick={handleGoogleSignIn}
            disabled={isLoading}
            data-testid="button-login-google"
          >
            <Chrome size={18} className="mr-2" />
            Continue with Google
          </Button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-brand-border/60" />
            </div>
            <div className="relative flex justify-center text-[10px] uppercase tracking-widest">
              <span className="bg-brand-bg px-2 text-brand-muted">or</span>
            </div>
          </div>

          <form className="space-y-3" onSubmit={handleEmailAuth} autoComplete="on">
            {isSignUp && (
              <div className="space-y-1.5">
                <Label htmlFor="username">Username</Label>
                <div className="relative">
                  <UserIcon size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-muted" />
                  <Input
                    id="username"
                    name="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="pl-9"
                    placeholder="Your name"
                    autoComplete="username"
                    data-testid="input-username"
                  />
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-muted" />
                <Input
                  id="email"
                  name="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-9"
                  placeholder="you@example.com"
                  required
                  autoComplete="email"
                  data-testid="input-email"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-muted" />
                <Input
                  id="password"
                  name="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-9"
                  placeholder="********"
                  required
                  minLength={6}
                  autoComplete={isSignUp ? "new-password" : "current-password"}
                  data-testid="input-password"
                />
              </div>
            </div>

            <Button
              type="submit"
              size="lg"
              className="w-full bg-brand-panel-2 border border-brand-border text-brand-text font-semibold"
              disabled={isLoading}
              data-testid="button-login-email"
            >
              <LogIn size={18} className="mr-2" />
              {isSignUp ? "Create account" : "Sign in with email"}
            </Button>
          </form>

          <button
            type="button"
            className="text-[11px] text-brand-muted hover:text-brand-text transition-colors"
            onClick={() => setIsSignUp((value) => !value)}
            data-testid="button-toggle-signup"
          >
            {isSignUp
              ? "Already have an account? Sign in"
              : "Need an account? Create one"}
          </button>
        </div>

        <p className="text-brand-muted/50 text-[10px] uppercase tracking-widest font-bold">
          Simple plan. Steady progress.
        </p>
      </div>
    </div>
  );
}
