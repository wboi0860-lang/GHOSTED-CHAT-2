import React, { useState } from 'react';
import {
  AlertTriangle,
  Ban,
  Check,
  ChevronRight,
  Copy,
  Crown,
  Eye,
  EyeOff,
  FileText,
  LogOut,
  Mail,
  MapPin,
  RefreshCw,
  Settings,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { GhostRoomProfile, VipRoomRecord } from '../types';
import {
  deleteAccountPermanently,
  detectCityCountry,
  fetchGhostProfile,
  formatExpiryDateLabel,
  getEffectivePaidTag,
  hasActiveVipBadge,
  signOutGhostAccount,
  unblockContactUser,
  updateGhostProfile,
} from '../services/roomService';
import { GhostAvatarView } from './GhostAvatarView';
import { GhostAvatarBuilderModal } from './GhostAvatarBuilderModal';
import { serializeGhostAvatar } from '../utils/ghostAvatar';
import {
  LegalDocType,
  LegalModal,
  REAL_PRIVACY_URL,
  REAL_TERMS_URL,
} from './LegalModal';
import { VipBadge } from './VipBadge';

interface ProfileTabProps {
  profile: GhostRoomProfile;
  vipRecord: VipRoomRecord | null;
  onProfileUpdated: (next: GhostRoomProfile) => void;
  onSignOut: () => void;
  onAccountDeleted: (deletedEmail: string) => void;
}

export const ProfileTab: React.FC<ProfileTabProps> = ({
  profile,
  vipRecord,
  onProfileUpdated,
  onSignOut,
  onAccountDeleted,
}) => {
  const [displayName, setDisplayName] = useState(profile.display_name);
  const [locationInput, setLocationInput] = useState(
    profile.location === 'Hidden' ? '' : profile.location || ''
  );
  const [saving, setSaving] = useState(false);
  const [savingLoc, setSavingLoc] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [savedLocNotice, setSavedLocNotice] = useState(false);
  const [copiedGh, setCopiedGh] = useState(false);
  const [detectingLoc, setDetectingLoc] = useState(false);
  const [showAvatarModal, setShowAvatarModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [legalDocModal, setLegalDocModal] = useState<LegalDocType | null>(null);
  const [unblockingGh, setUnblockingGh] = useState<string | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleteEmailFallback, setDeleteEmailFallback] = useState(profile.email || '');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  const blockedUsers = profile.blocked_users || [];

  const isVip = hasActiveVipBadge(vipRecord, profile);
  const paidTag = getEffectivePaidTag(vipRecord, profile);
  const vipExpiryLabel = formatExpiryDateLabel(
    vipRecord?.vip_features?.vip_expires_at || vipRecord?.vip_expires_at
  );

  const handleCopyGh = () => {
    navigator.clipboard?.writeText(profile.ghost_number).catch(() => {});
    setCopiedGh(true);
    setTimeout(() => setCopiedGh(false), 1800);
  };

  const handleSaveName = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const updated = await updateGhostProfile(profile.ghost_number, {
        display_name: displayName,
      });
      onProfileUpdated(updated);
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 1800);
    } catch (err: any) {
      setError(err?.message || 'Could not update display name.');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveLocation = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSavingLoc(true);
    try {
      const cleanLoc = locationInput.trim() || 'Unknown';
      const updated = await updateGhostProfile(profile.ghost_number, {
        location: cleanLoc,
        location_hidden: false,
      });
      onProfileUpdated(updated);
      setLocationInput(updated.location === 'Hidden' ? '' : updated.location);
      setSavedLocNotice(true);
      setTimeout(() => setSavedLocNotice(false), 1800);
    } catch (err: any) {
      setError(err?.message || 'Could not save location.');
    } finally {
      setSavingLoc(false);
    }
  };

  const handleToggleLocationHidden = async () => {
    setError('');
    try {
      const nextHidden = !profile.location_hidden;
      const fallbackLoc =
        locationInput.trim() ||
        (!nextHidden && profile.location === 'Hidden' ? await detectCityCountry() : undefined);
      const updated = await updateGhostProfile(profile.ghost_number, {
        location_hidden: nextHidden,
        ...(!nextHidden && fallbackLoc ? { location: fallbackLoc } : {}),
      });
      onProfileUpdated(updated);
    } catch (err: any) {
      setError(err?.message || 'Could not update location privacy.');
    }
  };

  const handleRefreshLocation = async () => {
    setDetectingLoc(true);
    setError('');
    try {
      const loc = await detectCityCountry();
      setLocationInput(loc);
      const updated = await updateGhostProfile(profile.ghost_number, {
        location: loc,
        location_hidden: false,
      });
      onProfileUpdated(updated);
    } catch (err: any) {
      setError(err?.message || 'Could not detect location.');
    } finally {
      setDetectingLoc(false);
    }
  };

  const handleToggleGhHidden = async () => {
    setError('');
    const nextHidden = !profile.gh_number_hidden;
    onProfileUpdated({
      ...profile,
      gh_number_hidden: nextHidden,
    });
    try {
      const updated = await updateGhostProfile(profile.ghost_number, {
        gh_number_hidden: nextHidden,
      });
      onProfileUpdated(updated);
    } catch (err: any) {
      onProfileUpdated({
        ...profile,
        gh_number_hidden: !nextHidden,
      });
      setError(err?.message || 'Could not update Ghosted Number visibility.');
    }
  };

  const handleConfirmDeleteAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (deleteConfirmText.trim() !== 'DELETE') {
      setError('Type DELETE in all caps to confirm account deletion.');
      return;
    }

    setError('');
    setDeleting(true);
    try {
      const { deletedEmail } = await deleteAccountPermanently({
        profile,
        emailOverride: deleteEmailFallback.trim() || profile.email,
      });
      setShowDeleteModal(false);
      onAccountDeleted(deletedEmail);
    } catch (err: any) {
      setError(err?.message || 'Could not complete account deletion.');
      setDeleting(false);
    }
  };

  const handleUnblockUser = async (peerGh: string) => {
    setUnblockingGh(peerGh);
    try {
      await unblockContactUser(profile.ghost_number, peerGh);
      const refreshed = await fetchGhostProfile(profile.ghost_number);
      if (refreshed) onProfileUpdated(refreshed);
    } catch (err: any) {
      setError(err?.message || 'Could not unblock user.');
    } finally {
      setUnblockingGh(null);
    }
  };

  return (
    <div className="max-w-lg mx-auto space-y-5 pb-6">
      {/* Top Action Row with Settings button */}
      <div className="flex items-center justify-between px-1">
        <h2 className="text-sm font-black uppercase tracking-wider text-zinc-300">Profile</h2>
        <button
          type="button"
          onClick={() => setShowSettingsModal(true)}
          className="min-h-[38px] px-3.5 rounded-xl bg-[#120D20] hover:bg-white/10 border border-white/15 text-xs font-bold text-zinc-200 flex items-center space-x-1.5 cursor-pointer"
        >
          <Settings className="w-3.5 h-3.5 text-cyan-300" />
          <span>Settings</span>
        </button>
      </div>

      {/* Big GH-XXXX Identity Card — Tap Avatar for Ghosts, Emojis, or Upload Photo */}
      <div
        className={`bg-[#120D20] rounded-3xl p-6 text-center space-y-4 ${
          isVip
            ? 'border-2 border-amber-400 shadow-[0_0_28px_rgba(251,191,36,0.22)]'
            : 'border border-purple-500/30'
        }`}
      >
        <div className="flex flex-col items-center space-y-3">
          <button
            type="button"
            onClick={() => setShowAvatarModal(true)}
            className="relative cursor-pointer group focus:outline-none flex flex-col items-center"
            aria-label="Edit Avatar"
          >
            <div
              className={`rounded-full ${
                isVip ? 'p-1 ring-2 ring-amber-400 shadow-[0_0_16px_rgba(251,191,36,0.35)]' : ''
              }`}
            >
              <GhostAvatarView config={profile.profile_pic} size={96} />
            </div>
            <span className="mt-2 inline-flex items-center space-x-1 text-xs font-semibold text-cyan-300">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Edit Avatar (Ghosts · Emojis · Photo)</span>
            </span>
          </button>

          <div className="flex items-center justify-center flex-wrap gap-2">
            <h3 className="text-lg font-black text-white">{profile.display_name}</h3>
            {isVip && <VipBadge />}
          </div>

          {isVip && (
            <div className="flex flex-col items-center space-y-0.5">
              <div className="inline-flex items-center space-x-1.5 text-xs font-bold text-amber-300">
                <Crown className="w-4 h-4" />
                <span>VIP Member</span>
              </div>
              {vipExpiryLabel && (
                <p className="text-[11px] font-mono text-amber-200/80">
                  VIP Active Until: {vipExpiryLabel}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="bg-black/50 border border-white/10 rounded-2xl p-4 space-y-2.5">
          <p className="text-[11px] uppercase tracking-widest text-zinc-400 font-semibold">
            Your Permanent Ghosted Number
          </p>
          <div className="flex items-center justify-center flex-wrap gap-2">
            <button
              type="button"
              onClick={handleToggleGhHidden}
              className="text-3xl font-mono font-black tracking-wider text-cyan-300 tabular-nums hover:opacity-85 transition cursor-pointer"
              title={profile.gh_number_hidden ? 'Tap to show GH-Number' : 'Tap to hide GH-Number'}
            >
              {profile.gh_number_hidden ? 'GH-XXXX' : profile.ghost_number}
            </button>
            {paidTag && (
              <span className="px-2.5 py-1 rounded-lg bg-amber-400/20 border border-amber-400/60 text-xs font-black text-amber-300">
                {paidTag}
              </span>
            )}
          </div>
          {profile.email && (
            <p className="text-xs font-mono text-zinc-400 flex items-center justify-center space-x-1.5">
              <Mail className="w-3.5 h-3.5 text-purple-400" />
              <span>{profile.email}</span>
            </p>
          )}
          <div className="flex items-center justify-center gap-2 pt-1">
            <button
              type="button"
              onClick={handleToggleGhHidden}
              className={`min-h-[44px] px-4 rounded-xl text-xs font-black inline-flex items-center space-x-1.5 cursor-pointer transition ${
                profile.gh_number_hidden
                  ? 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-400/40'
                  : 'bg-white/10 hover:bg-white/15 text-white border border-white/15'
              }`}
            >
              {profile.gh_number_hidden ? (
                <>
                  <Eye className="w-4 h-4" />
                  <span>Show</span>
                </>
              ) : (
                <>
                  <EyeOff className="w-4 h-4" />
                  <span>Hide</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={handleCopyGh}
              className="min-h-[44px] px-5 rounded-xl bg-[#00F5FF] hover:bg-[#00d8e6] text-black font-black text-xs inline-flex items-center space-x-1.5 cursor-pointer transition"
            >
              {copiedGh ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              <span>{copiedGh ? 'Copied GH-Number' : 'Copy Number'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Display Name */}
      <form
        onSubmit={handleSaveName}
        className="bg-[#120D20] border border-white/10 rounded-2xl p-4 space-y-3"
      >
        <label className="text-xs font-bold text-zinc-300 block">Display Name</label>
        <div className="flex items-center space-x-2">
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={28}
            className="flex-1 min-h-[46px] px-3.5 rounded-xl bg-black/60 border border-white/15 text-white text-sm focus:outline-none focus:border-cyan-400"
          />
          <button
            type="submit"
            disabled={saving}
            className="min-h-[46px] px-5 rounded-xl bg-[#7C3AED] hover:bg-[#8B5CF6] text-white font-bold text-xs cursor-pointer"
          >
            {saving ? '...' : savedNotice ? 'Saved' : 'Save'}
          </button>
        </div>
      </form>

      {/* Add / Edit / Hide Location in ghosted_room */}
      <div className="bg-[#120D20] border border-white/10 rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center space-x-2 min-w-0">
            <MapPin className="w-4 h-4 text-cyan-400 shrink-0" />
            <div className="min-w-0">
              <p className="text-xs font-bold text-zinc-300">Location</p>
              <p className="text-sm font-semibold text-white truncate">
                {profile.location_hidden ? 'Hidden' : profile.location || 'Unknown'}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-1.5 shrink-0">
            <button
              type="button"
              onClick={handleRefreshLocation}
              disabled={detectingLoc}
              className="min-h-[42px] px-3 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-bold text-zinc-200 flex items-center space-x-1.5 cursor-pointer"
              title="Auto-detect City, Country"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${detectingLoc ? 'animate-spin' : ''}`} />
              <span>Detect</span>
            </button>
            <button
              type="button"
              onClick={handleToggleLocationHidden}
              className={`min-h-[42px] px-3 rounded-xl text-xs font-bold flex items-center space-x-1.5 cursor-pointer ${
                profile.location_hidden
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/40'
                  : 'bg-white/5 hover:bg-white/10 text-zinc-200'
              }`}
            >
              {profile.location_hidden ? (
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
        </div>

        <form onSubmit={handleSaveLocation} className="flex items-center space-x-2">
          <input
            type="text"
            value={locationInput}
            onChange={(e) => setLocationInput(e.target.value)}
            placeholder="Add city or country (e.g. Lagos, Nigeria)"
            maxLength={50}
            className="flex-1 min-h-[44px] px-3.5 rounded-xl bg-black/60 border border-white/15 text-white placeholder-zinc-500 text-xs focus:outline-none focus:border-cyan-400"
          />
          <button
            type="submit"
            disabled={savingLoc}
            className="min-h-[44px] px-4 rounded-xl bg-[#00F5FF] hover:bg-[#00d8e6] text-black font-black text-xs cursor-pointer"
          >
            {savingLoc ? '...' : savedLocNotice ? 'Saved' : 'Save'}
          </button>
        </form>
      </div>

      {error && (
        <p className="text-xs text-rose-400 bg-rose-950/60 border border-rose-500/30 rounded-xl px-3 py-2">
          {error}
        </p>
      )}

      {/* Sign Out (keeps account in accounts table & GH-Number locked to email) */}
      <button
        type="button"
        onClick={async () => {
          await signOutGhostAccount({
            email: profile.email,
            ghostNumber: profile.ghost_number,
          });
          onSignOut();
        }}
        className="w-full min-h-[48px] rounded-2xl bg-white/10 hover:bg-white/15 border border-white/15 text-white font-bold text-sm flex items-center justify-center space-x-2 cursor-pointer transition"
      >
        <LogOut className="w-4 h-4 text-cyan-300" />
        <span>Sign Out (Keep GH-Number)</span>
      </button>

      {/* RED Delete & Burn Account Button (No Switch GH-Number) */}
      <button
        type="button"
        onClick={() => {
          setDeleteConfirmText('');
          setError('');
          setShowDeleteModal(true);
        }}
        className="w-full min-h-[50px] rounded-2xl bg-rose-600 hover:bg-rose-500 text-white font-black text-sm flex items-center justify-center space-x-2 cursor-pointer transition shadow-lg shadow-rose-950/50"
      >
        <Trash2 className="w-4 h-4" />
        <span>Delete &amp; Burn Account</span>
      </button>

      {/* LEGAL SECTION AT BOTTOM OF PROFILE */}
      <div className="bg-[#120D20] border border-white/10 rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <ShieldCheck className="w-4 h-4 text-cyan-400" />
            <h3 className="text-xs font-black uppercase tracking-wider text-zinc-200">Legal</h3>
          </div>
          <span className="text-[11px] text-zinc-400">Ghosted Number</span>
        </div>

        <div className="divide-y divide-white/10">
          <a
            href={REAL_PRIVACY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full px-4 min-h-[50px] flex items-center justify-between hover:bg-white/5 transition text-sm font-bold text-white"
          >
            <span className="flex items-center space-x-2.5">
              <ShieldCheck className="w-4 h-4 text-blue-400" />
              <span>Privacy Policy</span>
            </span>
            <ChevronRight className="w-4 h-4 text-zinc-400" />
          </a>

          <a
            href={REAL_TERMS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full px-4 min-h-[50px] flex items-center justify-between hover:bg-white/5 transition text-sm font-bold text-white"
          >
            <span className="flex items-center space-x-2.5">
              <FileText className="w-4 h-4 text-blue-400" />
              <span>Terms &amp; Conditions</span>
            </span>
            <ChevronRight className="w-4 h-4 text-zinc-400" />
          </a>
        </div>

        <div className="px-4 py-2.5 bg-black/40 border-t border-white/10 flex items-center justify-between text-[11px] text-zinc-400">
          <button
            type="button"
            onClick={() => setLegalDocModal('privacy')}
            className="underline hover:text-cyan-300 cursor-pointer"
          >
            Read Privacy Policy In-App
          </button>
          <button
            type="button"
            onClick={() => setLegalDocModal('terms')}
            className="underline hover:text-cyan-300 cursor-pointer"
          >
            Read Terms In-App
          </button>
        </div>
      </div>

      {showAvatarModal && (
        <GhostAvatarBuilderModal
          currentConfig={profile.profile_pic}
          ghostNumber={profile.ghost_number}
          onClose={() => setShowAvatarModal(false)}
          onSave={(cfg) => {
            onProfileUpdated({
              ...profile,
              profile_pic: serializeGhostAvatar(cfg),
            });
          }}
        />
      )}

      {/* Confirm Delete & Burn Account Modal (Type DELETE) */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-[500] bg-black/90 backdrop-blur-md flex items-center justify-center p-4">
          <form
            onSubmit={handleConfirmDeleteAccount}
            className="w-full max-w-md rounded-3xl bg-[#120D20] border-2 border-rose-500 p-5 sm:p-6 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2 text-rose-400">
                <AlertTriangle className="w-5 h-5" />
                <h3 className="text-base font-black text-white">Delete &amp; Burn Account</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowDeleteModal(false)}
                className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-full text-zinc-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-zinc-300 leading-relaxed">
              This will permanently delete and burn your profile, chats, messages, ghosted_room,
              location, VIP status, and Auth user. Afterward, you can create a brand new account.
            </p>

            {!profile.email && (
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-zinc-300 block">
                  Email to permanently blocklist
                </label>
                <input
                  type="email"
                  required
                  value={deleteEmailFallback}
                  onChange={(e) => setDeleteEmailFallback(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full min-h-[44px] px-3.5 rounded-xl bg-black/60 border border-white/15 text-white text-sm focus:outline-none focus:border-rose-400"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-rose-300 block">
                Type <span className="font-mono text-white">DELETE</span> to confirm
              </label>
              <input
                type="text"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder="Type DELETE"
                autoFocus
                className="w-full min-h-[46px] px-3.5 rounded-xl bg-black/70 border-2 border-rose-500/60 text-white font-mono text-sm focus:outline-none focus:border-rose-400"
              />
            </div>

            {error && (
              <p className="text-xs text-rose-300 bg-rose-950/60 border border-rose-500/40 rounded-xl px-3 py-2">
                {error}
              </p>
            )}

            <div className="flex items-center space-x-2 pt-1">
              <button
                type="button"
                onClick={() => setShowDeleteModal(false)}
                className="flex-1 min-h-[46px] rounded-xl bg-white/10 hover:bg-white/15 text-zinc-200 font-bold text-xs cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={deleting || deleteConfirmText.trim() !== 'DELETE'}
                className="flex-1 min-h-[46px] rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-white font-black text-xs cursor-pointer"
              >
                {deleting ? 'Deleting...' : 'Confirm Delete'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* SETTINGS MODAL (Includes Blocked Users + Same 2 Legal Rows + In-App Pages) */}
      {showSettingsModal && (
        <div className="fixed inset-0 z-[500] bg-black/90 backdrop-blur-md flex items-center justify-center p-4">
          <div className="w-full max-w-md max-h-[85vh] overflow-y-auto rounded-3xl bg-[#120D20] border border-cyan-400/35 p-5 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Settings className="w-5 h-5 text-cyan-300" />
                <h3 className="text-base font-black text-white">Settings</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowSettingsModal(false)}
                className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-full text-zinc-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Ghosted Number Visibility inside Settings */}
            <div className="p-3.5 rounded-2xl bg-black/45 border border-white/10 flex items-center justify-between gap-2">
              <div>
                <p className="text-xs font-bold text-white">Ghosted Number Visibility</p>
                <p className="text-[11px] text-zinc-400">
                  {profile.gh_number_hidden
                    ? 'Number is hidden as GH-XXXX'
                    : `Showing ${profile.ghost_number}`}
                </p>
              </div>
              <button
                type="button"
                onClick={handleToggleGhHidden}
                className="min-h-[38px] px-3 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-bold text-white cursor-pointer"
              >
                {profile.gh_number_hidden ? 'Show' : 'Hide'}
              </button>
            </div>

            {/* Privacy Toggle inside Settings */}
            <div className="p-3.5 rounded-2xl bg-black/45 border border-white/10 flex items-center justify-between gap-2">
              <div>
                <p className="text-xs font-bold text-white">Location Visibility</p>
                <p className="text-[11px] text-zinc-400">
                  {profile.location_hidden ? 'Location is Hidden' : 'Location visible on profile'}
                </p>
              </div>
              <button
                type="button"
                onClick={handleToggleLocationHidden}
                className="min-h-[38px] px-3 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-bold text-white cursor-pointer"
              >
                {profile.location_hidden ? 'Show' : 'Hide'}
              </button>
            </div>

            {/* Blocked Users inside Settings */}
            <div className="rounded-2xl bg-black/45 border border-white/10 overflow-hidden">
              <div className="px-4 py-2.5 border-b border-white/10 flex items-center space-x-2">
                <Ban className="w-4 h-4 text-rose-400" />
                <span className="text-xs font-bold text-zinc-200">
                  Blocked Users ({blockedUsers.length})
                </span>
              </div>
              {blockedUsers.length === 0 ? (
                <p className="px-4 py-3 text-xs text-zinc-500">No blocked users.</p>
              ) : (
                <div className="divide-y divide-white/10">
                  {blockedUsers.map((gh) => (
                    <div key={gh} className="px-4 py-2.5 flex items-center justify-between">
                      <span className="text-xs font-mono font-bold text-white">{gh}</span>
                      <button
                        type="button"
                        disabled={unblockingGh === gh}
                        onClick={() => handleUnblockUser(gh)}
                        className="min-h-[34px] px-3 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-bold text-cyan-300 cursor-pointer"
                      >
                        {unblockingGh === gh ? '...' : 'Unblock'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Legal Section inside Settings */}
            <div className="rounded-2xl bg-black/45 border border-white/10 overflow-hidden">
              <div className="px-4 py-2.5 border-b border-white/10 flex items-center space-x-2">
                <ShieldCheck className="w-4 h-4 text-cyan-400" />
                <span className="text-xs font-black uppercase tracking-wider text-zinc-200">
                  Legal
                </span>
              </div>
              <div className="divide-y divide-white/10">
                <a
                  href={REAL_PRIVACY_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full px-4 min-h-[48px] flex items-center justify-between hover:bg-white/5 transition text-sm font-bold text-white"
                >
                  <span className="flex items-center space-x-2.5">
                    <ShieldCheck className="w-4 h-4 text-blue-400" />
                    <span>Privacy Policy</span>
                  </span>
                  <ChevronRight className="w-4 h-4 text-zinc-400" />
                </a>
                <a
                  href={REAL_TERMS_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full px-4 min-h-[48px] flex items-center justify-between hover:bg-white/5 transition text-sm font-bold text-white"
                >
                  <span className="flex items-center space-x-2.5">
                    <FileText className="w-4 h-4 text-blue-400" />
                    <span>Terms &amp; Conditions</span>
                  </span>
                  <ChevronRight className="w-4 h-4 text-zinc-400" />
                </a>
              </div>
              <div className="px-4 py-2.5 bg-black/40 border-t border-white/10 flex items-center justify-between text-[11px] text-zinc-400">
                <button
                  type="button"
                  onClick={() => setLegalDocModal('privacy')}
                  className="underline hover:text-cyan-300 cursor-pointer"
                >
                  Read Privacy In-App
                </button>
                <button
                  type="button"
                  onClick={() => setLegalDocModal('terms')}
                  className="underline hover:text-cyan-300 cursor-pointer"
                >
                  Read Terms In-App
                </button>
              </div>
            </div>
          </div>
        </div>
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
