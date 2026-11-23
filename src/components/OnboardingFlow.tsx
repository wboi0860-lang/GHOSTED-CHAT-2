import React, { useEffect, useState } from 'react';
import {
  AlertOctagon,
  ArrowRight,
  Eye,
  EyeOff,
  Lock,
  Mail,
  MapPin,
  Sparkles,
} from 'lucide-react';
import { GhostRoomProfile } from '../types';
import {
  checkLoginSession,
  createGhostAccountWithEmail,
  detectCityCountry,
  hasExistingGhostedAccount,
  signInWithEmail,
} from '../services/roomService';
import {
  generateRandomGhostAvatar,
  GhostAvatarConfig,
  serializeGhostAvatar,
} from '../utils/ghostAvatar';
import { GhostAvatarView } from './GhostAvatarView';
import { GhostAvatarBuilderModal } from './GhostAvatarBuilderModal';
import {
  LegalDocType,
  LegalModal,
  REAL_PRIVACY_URL,
  REAL_TERMS_URL,
} from './LegalModal';

interface OnboardingFlowProps {
  sessionExpiredNotice?: string | null;
  onComplete: (profile: GhostRoomProfile) => void;
}

export const OnboardingFlow: React.FC<OnboardingFlowProps> = ({
  sessionExpiredNotice,
  onComplete,
}) => {
  const existingAccountOnDevice = hasExistingGhostedAccount();
  const [mode, setMode] = useState<'create' | 'login'>(() =>
    existingAccountOnDevice ? 'login' : 'create'
  );
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [location, setLocation] = useState('Detecting...');
  const [locationHidden, setLocationHidden] = useState(false);
  const [avatarConfig, setAvatarConfig] = useState<GhostAvatarConfig>(() =>
    generateRandomGhostAvatar()
  );
  const [showAvatarModal, setShowAvatarModal] = useState(false);
  const [acceptedLegal, setAcceptedLegal] = useState(false);
  const [legalDocModal, setLegalDocModal] = useState<LegalDocType | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    detectCityCountry().then((loc) => setLocation(loc));
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const guard = checkLoginSession(true);
    if (!guard.allowed) {
      setError(
        guard.message ||
          'You already have an account. Delete and burn your old account to create a new one.'
      );
      return;
    }

    if (!acceptedLegal) {
      setError('Please accept Terms & Conditions to continue');
      return;
    }

    setLoading(true);
    try {
      const profile = await createGhostAccountWithEmail({
        email,
        password,
        displayName: displayName.trim() || 'Ghost User',
        profilePic: serializeGhostAvatar(avatarConfig),
        location,
        locationHidden,
        acceptedLegal: true,
      });
      try {
        localStorage.setItem(
          'ghosted_legal_accepted',
          JSON.stringify({
            accepted: true,
            email: email.trim().toLowerCase(),
            acceptedAt: new Date().toISOString(),
          })
        );
      } catch {}
      onComplete(profile);
    } catch (err: any) {
      setError(err?.message || 'Could not create account.');
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const profile = await signInWithEmail(email, password);
      onComplete(profile);
    } catch (err: any) {
      setError(err?.message || 'Could not sign in.');
    } finally {
      setLoading(false);
    }
  };

  const isDeletedEmailError =
    error.includes('Account Deleted') || error.toLowerCase().includes('used before');

  return (
    <div className="min-h-screen bg-[#090710] text-white flex flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-md bg-[#120D20] border border-purple-500/30 rounded-3xl p-6 shadow-2xl space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-black tracking-tight text-white">GHOSTED</h1>
          <p className="text-xs text-zinc-400">
            One email = One permanent GH-Number forever.
          </p>
        </div>

        {sessionExpiredNotice && (
          <div className="rounded-2xl bg-amber-950/60 border border-amber-400/50 px-3.5 py-2.5 text-xs text-amber-200 font-semibold text-center">
            {sessionExpiredNotice}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 p-1 rounded-2xl bg-black/50 border border-white/10">
          <button
            type="button"
            onClick={() => {
              const guard = checkLoginSession(true);
              if (!guard.allowed) {
                setMode('create');
                setError(
                  guard.message ||
                    'You already have an account. Delete and burn your old account to create a new one.'
                );
                return;
              }
              setMode('create');
              setError('');
            }}
            className={`min-h-[44px] rounded-xl text-sm font-bold transition cursor-pointer ${
              mode === 'create' ? 'bg-[#7C3AED] text-white' : 'text-zinc-400 hover:text-white'
            }`}
          >
            Create Account
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('login');
              setError('');
            }}
            className={`min-h-[44px] rounded-xl text-sm font-bold transition cursor-pointer ${
              mode === 'login' ? 'bg-[#7C3AED] text-white' : 'text-zinc-400 hover:text-white'
            }`}
          >
            Sign In
          </button>
        </div>

        {mode === 'create' ? (
          existingAccountOnDevice ? (
            <div className="space-y-4 py-2">
              <div className="rounded-2xl bg-rose-950/75 border-2 border-rose-500/70 p-4 space-y-2 text-center">
                <AlertOctagon className="w-7 h-7 text-rose-400 mx-auto" />
                <p className="text-sm font-black text-white">Account Already Exists</p>
                <p className="text-xs text-rose-200 leading-relaxed">
                  You already have an account. Delete and burn your old account to create a new one.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setError('');
                }}
                className="w-full min-h-[50px] rounded-2xl bg-[#00F5FF] hover:bg-[#00d8e6] text-black font-black text-sm flex items-center justify-center space-x-2 transition cursor-pointer"
              >
                <span>Go to Sign In</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          ) : (
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="flex flex-col items-center space-y-2 py-1">
              <button
                type="button"
                onClick={() => setShowAvatarModal(true)}
                className="relative group cursor-pointer focus:outline-none flex flex-col items-center"
                aria-label="Edit Avatar"
              >
                <GhostAvatarView config={avatarConfig} size={92} />
                <span className="mt-2 inline-flex items-center space-x-1 text-xs font-semibold text-cyan-300">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Ghosts · Emojis · Upload Photo</span>
                </span>
              </button>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-zinc-300 block">Email</label>
              <div className="relative">
                <Mail className="w-4 h-4 text-zinc-500 absolute left-4 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full min-h-[48px] pl-11 pr-4 rounded-2xl bg-black/60 border border-white/15 text-white placeholder-zinc-500 text-sm focus:outline-none focus:border-cyan-400"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-zinc-300 block">Password</label>
              <div className="relative">
                <Lock className="w-4 h-4 text-zinc-500 absolute left-4 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Min 6 characters"
                  className="w-full min-h-[48px] pl-11 pr-4 rounded-2xl bg-black/60 border border-white/15 text-white placeholder-zinc-500 text-sm focus:outline-none focus:border-cyan-400"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-zinc-300 block">
                Display Name
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g. Shadow Fox"
                maxLength={28}
                className="w-full min-h-[48px] px-4 rounded-2xl bg-black/60 border border-white/15 text-white placeholder-zinc-500 text-sm focus:outline-none focus:border-cyan-400"
              />
            </div>

            <div className="flex items-center justify-between px-4 min-h-[48px] rounded-2xl bg-black/40 border border-white/10">
              <div className="flex items-center space-x-2 min-w-0">
                <MapPin className="w-4 h-4 text-cyan-400 shrink-0" />
                <span className="text-xs text-zinc-300 truncate">
                  {locationHidden ? 'Location Hidden' : location}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setLocationHidden((prev) => !prev)}
                className="min-h-[36px] px-3 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-semibold text-zinc-200 flex items-center space-x-1.5 cursor-pointer shrink-0"
              >
                {locationHidden ? (
                  <>
                    <Eye className="w-3.5 h-3.5" />
                    <span>Show</span>
                  </>
                ) : (
                  <>
                    <EyeOff className="w-3.5 h-3.5" />
                    <span>Hide</span>
                  </>
                )}
              </button>
            </div>

            {/* Required Legal Acceptance Checkbox above Sign Up */}
            <div className="rounded-2xl bg-black/45 border border-white/10 p-3.5 space-y-2">
              <label className="flex items-start space-x-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={acceptedLegal}
                  onChange={(e) => {
                    setAcceptedLegal(e.target.checked);
                    if (e.target.checked && error === 'Please accept Terms & Conditions to continue') {
                      setError('');
                    }
                  }}
                  className="mt-0.5 w-4 h-4 rounded border-white/30 bg-black text-cyan-400 focus:ring-cyan-400 cursor-pointer shrink-0"
                />
                <span className="text-xs text-zinc-200 leading-relaxed">
                  I agree to the{' '}
                  <a
                    href={REAL_PRIVACY_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-blue-400 hover:text-blue-300 underline font-bold"
                  >
                    Privacy Policy
                  </a>{' '}
                  and{' '}
                  <a
                    href={REAL_TERMS_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-blue-400 hover:text-blue-300 underline font-bold"
                  >
                    Terms &amp; Conditions
                  </a>
                </span>
              </label>

              <div className="flex items-center space-x-3 pl-7 text-[11px] text-zinc-400">
                <button
                  type="button"
                  onClick={() => setLegalDocModal('privacy')}
                  className="underline hover:text-cyan-300 cursor-pointer"
                >
                  Read Privacy in-app
                </button>
                <span>·</span>
                <button
                  type="button"
                  onClick={() => setLegalDocModal('terms')}
                  className="underline hover:text-cyan-300 cursor-pointer"
                >
                  Read Terms in-app
                </button>
              </div>
            </div>

            {error && (
              <div
                className={`text-xs rounded-xl px-3.5 py-2.5 border flex items-start space-x-2 ${
                  isDeletedEmailError
                    ? 'bg-rose-950/80 border-rose-500 text-rose-200 font-bold'
                    : 'bg-rose-950/50 border-rose-500/30 text-rose-400'
                }`}
              >
                {isDeletedEmailError && <AlertOctagon className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />}
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full min-h-[50px] rounded-2xl bg-[#00F5FF] hover:bg-[#00d8e6] text-black font-black text-sm flex items-center justify-center space-x-2 transition cursor-pointer disabled:opacity-50"
            >
              <span>{loading ? 'Creating GH-Number...' : 'Create Account & GH-Number'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
          )
        ) : (
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-zinc-300 block">Email</label>
              <div className="relative">
                <Mail className="w-4 h-4 text-zinc-500 absolute left-4 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full min-h-[48px] pl-11 pr-4 rounded-2xl bg-black/60 border border-white/15 text-white placeholder-zinc-500 text-sm focus:outline-none focus:border-cyan-400"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-zinc-300 block">Password</label>
              <div className="relative">
                <Lock className="w-4 h-4 text-zinc-500 absolute left-4 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Your password"
                  className="w-full min-h-[48px] pl-11 pr-4 rounded-2xl bg-black/60 border border-white/15 text-white placeholder-zinc-500 text-sm focus:outline-none focus:border-cyan-400"
                />
              </div>
            </div>

            {error && (
              <div
                className={`text-xs rounded-xl px-3.5 py-2.5 border flex items-start space-x-2 ${
                  isDeletedEmailError
                    ? 'bg-rose-950/80 border-rose-500 text-rose-200 font-bold'
                    : 'bg-rose-950/50 border-rose-500/30 text-rose-400'
                }`}
              >
                {isDeletedEmailError && <AlertOctagon className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />}
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full min-h-[50px] rounded-2xl bg-[#00F5FF] hover:bg-[#00d8e6] text-black font-black text-sm flex items-center justify-center space-x-2 transition cursor-pointer disabled:opacity-50"
            >
              <span>{loading ? 'Signing In...' : 'Sign In to My GH-Number'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        )}
      </div>

      {showAvatarModal && (
        <GhostAvatarBuilderModal
          currentConfig={avatarConfig}
          skipRemoteSave
          onClose={() => setShowAvatarModal(false)}
          onSave={(cfg) => setAvatarConfig(cfg)}
        />
      )}

      {legalDocModal && (
        <LegalModal
          docType={legalDocModal}
          onSwitchDoc={(next) => setLegalDocModal(next)}
          onClose={() => setLegalDocModal(null)}
        />
      )}
    </div>
  );
};
