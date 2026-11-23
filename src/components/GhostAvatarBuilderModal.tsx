import React, { useRef, useState } from 'react';
import {
  AVATAR_EMOJIS,
  GhostAvatarConfig,
  GHOST_COLORS,
  GHOST_EYES,
  GHOST_MOUTHS,
  GHOST_ACCESSORIES,
  parseGhostAvatar,
  serializeGhostAvatar,
} from '../utils/ghostAvatar';
import { GhostAvatarView } from './GhostAvatarView';
import { Camera, Check, Dices, Smile, Sparkles, Trash2, Upload, X } from 'lucide-react';
import { updateGhostProfile } from '../services/roomService';
import { normalizeGhostNumber } from '../utils/ghostNumber';
import { supabase } from '../supabase';

interface GhostAvatarBuilderModalProps {
  currentConfig?: GhostAvatarConfig | string | null;
  ghostNumber?: string;
  skipRemoteSave?: boolean;
  onClose: () => void;
  onSave: (savedConfig: GhostAvatarConfig) => void;
}

type PrimaryPickerMode = 'ghosts' | 'emojis' | 'photo';
type GhostSubTab = 'color' | 'eyes' | 'mouth' | 'accessory';

async function compressAvatarPhoto(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read image file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Invalid image file.'));
      img.onload = () => {
        const size = 256;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas not supported.'));
          return;
        }
        const minSide = Math.min(img.width, img.height);
        const sx = (img.width - minSide) / 2;
        const sy = (img.height - minSide) / 2;
        ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);
        canvas.toBlob(
          (blob) => {
            if (!blob) reject(new Error('Could not process photo.'));
            else resolve(blob);
          },
          'image/jpeg',
          0.8
        );
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not encode photo.'));
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(blob);
  });
}

export const GhostAvatarBuilderModal: React.FC<GhostAvatarBuilderModalProps> = ({
  currentConfig,
  ghostNumber,
  skipRemoteSave = false,
  onClose,
  onSave,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const initialParsed = parseGhostAvatar(currentConfig);

  const [avatar, setAvatar] = useState<GhostAvatarConfig>(initialParsed);
  const [mode, setMode] = useState<PrimaryPickerMode>(() =>
    initialParsed.photoUrl ? 'photo' : initialParsed.emoji ? 'emojis' : 'ghosts'
  );
  const [ghostTab, setGhostTab] = useState<GhostSubTab>('color');
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const displayNum = normalizeGhostNumber(ghostNumber) || '';

  const handleRandomize = () => {
    const randomColor = GHOST_COLORS[Math.floor(Math.random() * GHOST_COLORS.length)].id;
    const randomEyes = GHOST_EYES[Math.floor(Math.random() * GHOST_EYES.length)].id;
    const randomMouth = GHOST_MOUTHS[Math.floor(Math.random() * GHOST_MOUTHS.length)].id;
    const randomAccessory =
      GHOST_ACCESSORIES[Math.floor(Math.random() * GHOST_ACCESSORIES.length)].id;

    setAvatar({
      color: randomColor,
      eyes: randomEyes,
      mouth: randomMouth,
      accessory: randomAccessory,
      emoji: undefined,
      photoUrl: undefined,
    });
    setMode('ghosts');
  };

  const handlePhotoSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setUploadError('Please select a valid image file (JPG, PNG, WEBP).');
      return;
    }

    setUploadError('');
    setUploadingPhoto(true);
    try {
      const compressedBlob = await compressAvatarPhoto(file);
      let finalUrl = '';

      // Try Supabase Storage `avatars` bucket first; gracefully fall back to compressed data URL
      try {
        const fileName = `${displayNum || 'new'}-${Date.now()}.jpg`;
        const { error: upErr } = await supabase.storage
          .from('avatars')
          .upload(fileName, compressedBlob, {
            contentType: 'image/jpeg',
            upsert: true,
          });
        if (!upErr) {
          const { data: pubData } = supabase.storage.from('avatars').getPublicUrl(fileName);
          if (pubData?.publicUrl) {
            finalUrl = pubData.publicUrl;
          }
        }
      } catch {
        // Fallback below
      }

      if (!finalUrl) {
        finalUrl = await blobToDataUrl(compressedBlob);
      }

      setAvatar((prev) => ({
        ...prev,
        emoji: undefined,
        photoUrl: finalUrl,
      }));
      setMode('photo');
    } catch (err: any) {
      setUploadError(err?.message || 'Could not process selected photo.');
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setUploadError('');
    const jsonString = serializeGhostAvatar(avatar);

    try {
      localStorage.setItem('ghosted_avatar_config', jsonString);
    } catch {}

    if (!skipRemoteSave && displayNum) {
      try {
        await updateGhostProfile(displayNum, { profile_pic: jsonString });
      } catch (err: any) {
        setUploadError(err?.message || 'Could not save avatar to Supabase.');
        setIsSaving(false);
        return;
      }
    }

    setIsSaving(false);
    onSave(avatar);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md select-none">
      <div className="w-full max-w-md rounded-3xl bg-[#110C1F] border border-purple-500/40 p-5 sm:p-6 shadow-2xl flex flex-col space-y-4 max-h-[92vh] overflow-y-auto relative">
        <div className="flex items-center justify-between pb-2 border-b border-white/10">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 rounded-xl bg-[#7C3AED] flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <h3 className="text-base font-bold text-white">Avatar Picker</h3>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full text-zinc-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Live Preview */}
        <div className="relative py-4 px-6 rounded-2xl bg-black/50 border border-purple-500/30 flex flex-col items-center justify-center overflow-hidden">
          <div className="absolute w-36 h-36 rounded-full bg-purple-500/20 blur-2xl pointer-events-none" />
          <GhostAvatarView config={avatar} size={112} animate={!avatar.photoUrl} className="relative z-10" />

          <button
            type="button"
            onClick={handleRandomize}
            className="absolute top-3 right-3 px-3 min-h-[36px] rounded-xl bg-purple-900/50 hover:bg-purple-800/70 border border-purple-500/40 text-xs font-mono font-bold text-purple-200 flex items-center space-x-1.5 transition cursor-pointer"
          >
            <Dices className="w-3.5 h-3.5" />
            <span>Random Ghost</span>
          </button>

          {displayNum && (
            <span className="relative z-10 text-xs font-mono font-bold text-cyan-300 mt-2">
              {displayNum}
            </span>
          )}
        </div>

        {/* Primary 3 Modes: Ghosts | Emojis | Upload Photo */}
        <div className="grid grid-cols-3 gap-1.5 p-1 rounded-2xl bg-black/50 border border-white/10">
          <button
            type="button"
            onClick={() => {
              setMode('ghosts');
              setAvatar((prev) => ({ ...prev, emoji: undefined, photoUrl: undefined }));
            }}
            className={`min-h-[44px] rounded-xl text-xs font-black transition flex items-center justify-center space-x-1.5 cursor-pointer ${
              mode === 'ghosts' ? 'bg-[#7C3AED] text-white' : 'text-zinc-400 hover:text-white'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Ghosts</span>
          </button>

          <button
            type="button"
            onClick={() => setMode('emojis')}
            className={`min-h-[44px] rounded-xl text-xs font-black transition flex items-center justify-center space-x-1.5 cursor-pointer ${
              mode === 'emojis' ? 'bg-[#7C3AED] text-white' : 'text-zinc-400 hover:text-white'
            }`}
          >
            <Smile className="w-3.5 h-3.5" />
            <span>Emojis</span>
          </button>

          <button
            type="button"
            onClick={() => setMode('photo')}
            className={`min-h-[44px] rounded-xl text-xs font-black transition flex items-center justify-center space-x-1.5 cursor-pointer ${
              mode === 'photo' ? 'bg-[#7C3AED] text-white' : 'text-zinc-400 hover:text-white'
            }`}
          >
            <Camera className="w-3.5 h-3.5" />
            <span>Upload Photo</span>
          </button>
        </div>

        {/* GHOSTS MODE */}
        {mode === 'ghosts' && (
          <div className="space-y-3">
            <div className="grid grid-cols-4 gap-1 p-1 rounded-xl bg-black/40 border border-white/10">
              {(
                [
                  { id: 'color', label: 'Color' },
                  { id: 'eyes', label: 'Eyes' },
                  { id: 'mouth', label: 'Mouth' },
                  { id: 'accessory', label: 'Item' },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setGhostTab(t.id)}
                  className={`min-h-[38px] rounded-lg text-[11px] font-bold transition cursor-pointer ${
                    ghostTab === t.id
                      ? 'bg-cyan-400 text-black'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {ghostTab === 'color' && (
              <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
                {GHOST_COLORS.map((c) => {
                  const isSelected = avatar.color === c.id && !avatar.emoji && !avatar.photoUrl;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() =>
                        setAvatar((prev) => ({
                          ...prev,
                          color: c.id,
                          emoji: undefined,
                          photoUrl: undefined,
                        }))
                      }
                      className={`flex flex-col items-center p-2 rounded-2xl border transition cursor-pointer ${
                        isSelected
                          ? 'border-white bg-white/15'
                          : 'border-white/10 bg-black/30 hover:border-white/30'
                      }`}
                    >
                      <div
                        className="w-7 h-7 rounded-full border border-white/40 mb-1 flex items-center justify-center"
                        style={{ backgroundColor: c.hex }}
                      >
                        {isSelected && <Check className="w-3.5 h-3.5 text-black stroke-[3]" />}
                      </div>
                      <span className="text-[10px] font-semibold text-white truncate">{c.label}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {ghostTab === 'eyes' && (
              <div className="grid grid-cols-3 gap-2">
                {GHOST_EYES.map((e) => {
                  const isSelected = avatar.eyes === e.id && !avatar.emoji && !avatar.photoUrl;
                  return (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() =>
                        setAvatar((prev) => ({
                          ...prev,
                          eyes: e.id,
                          emoji: undefined,
                          photoUrl: undefined,
                        }))
                      }
                      className={`min-h-[60px] p-3 rounded-2xl border flex flex-col items-center justify-center transition cursor-pointer ${
                        isSelected
                          ? 'border-purple-400 bg-purple-600/25'
                          : 'border-white/10 bg-black/30 hover:border-white/30'
                      }`}
                    >
                      <span className="text-base font-black text-amber-300 font-mono">{e.icon}</span>
                      <span className="text-xs font-semibold text-white capitalize">{e.label}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {ghostTab === 'mouth' && (
              <div className="grid grid-cols-3 gap-2">
                {GHOST_MOUTHS.map((m) => {
                  const isSelected = avatar.mouth === m.id && !avatar.emoji && !avatar.photoUrl;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() =>
                        setAvatar((prev) => ({
                          ...prev,
                          mouth: m.id,
                          emoji: undefined,
                          photoUrl: undefined,
                        }))
                      }
                      className={`min-h-[60px] p-3 rounded-2xl border flex flex-col items-center justify-center transition cursor-pointer ${
                        isSelected
                          ? 'border-purple-400 bg-purple-600/25'
                          : 'border-white/10 bg-black/30 hover:border-white/30'
                      }`}
                    >
                      <span className="text-base font-black text-pink-400 font-mono">{m.icon}</span>
                      <span className="text-xs font-semibold text-white capitalize">{m.label}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {ghostTab === 'accessory' && (
              <div className="grid grid-cols-4 gap-2">
                {GHOST_ACCESSORIES.map((a) => {
                  const isSelected = avatar.accessory === a.id && !avatar.emoji && !avatar.photoUrl;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() =>
                        setAvatar((prev) => ({
                          ...prev,
                          accessory: a.id,
                          emoji: undefined,
                          photoUrl: undefined,
                        }))
                      }
                      className={`min-h-[60px] p-2 rounded-2xl border flex flex-col items-center justify-center transition cursor-pointer ${
                        isSelected
                          ? 'border-purple-400 bg-purple-600/25'
                          : 'border-white/10 bg-black/30 hover:border-white/30'
                      }`}
                    >
                      <span className="text-xl">{a.icon}</span>
                      <span className="text-[11px] font-semibold text-white capitalize truncate">
                        {a.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* EMOJIS MODE */}
        {mode === 'emojis' && (
          <div className="space-y-3">
            <div className="grid grid-cols-6 gap-2">
              {AVATAR_EMOJIS.map((em) => {
                const isSelected = avatar.emoji === em && !avatar.photoUrl;
                return (
                  <button
                    key={em}
                    type="button"
                    onClick={() =>
                      setAvatar((prev) => ({ ...prev, emoji: em, photoUrl: undefined }))
                    }
                    className={`min-h-[50px] rounded-2xl border text-2xl flex items-center justify-center transition cursor-pointer ${
                      isSelected
                        ? 'border-cyan-400 bg-cyan-400/20 scale-105'
                        : 'border-white/10 bg-black/40 hover:border-white/30'
                    }`}
                  >
                    {em}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* UPLOAD PHOTO MODE */}
        {mode === 'photo' && (
          <div className="space-y-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handlePhotoSelected}
              className="hidden"
            />
            <button
              type="button"
              disabled={uploadingPhoto}
              onClick={() => fileInputRef.current?.click()}
              className="w-full min-h-[54px] rounded-2xl bg-black/50 hover:bg-white/10 border-2 border-dashed border-cyan-400/60 text-cyan-300 font-bold text-sm flex items-center justify-center space-x-2 cursor-pointer disabled:opacity-50"
            >
              <Upload className="w-4 h-4" />
              <span>
                {uploadingPhoto
                  ? 'Processing Photo...'
                  : avatar.photoUrl
                  ? 'Choose Different Photo'
                  : 'Upload Photo from Device'}
              </span>
            </button>

            {avatar.photoUrl && (
              <button
                type="button"
                onClick={() => {
                  setAvatar((prev) => ({ ...prev, photoUrl: undefined }));
                  setMode('ghosts');
                }}
                className="w-full min-h-[42px] rounded-xl bg-rose-600/20 hover:bg-rose-600/35 border border-rose-500/40 text-rose-200 font-bold text-xs flex items-center justify-center space-x-1.5 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Remove Photo &amp; Use Ghost</span>
              </button>
            )}
          </div>
        )}

        {uploadError && (
          <p className="text-xs text-rose-400 bg-rose-950/60 border border-rose-500/30 rounded-xl px-3 py-2">
            {uploadError}
          </p>
        )}

        <button
          type="button"
          disabled={isSaving || uploadingPhoto}
          onClick={handleSave}
          className="w-full min-h-[48px] rounded-2xl bg-[#00F5FF] hover:bg-[#00d8e6] text-black font-black text-sm flex items-center justify-center space-x-2 transition cursor-pointer disabled:opacity-50"
        >
          <Check className="w-4 h-4 stroke-[2.5]" />
          <span>{isSaving ? 'Saving to Supabase...' : 'Save Avatar'}</span>
        </button>
      </div>
    </div>
  );
};
