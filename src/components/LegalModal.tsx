import React from 'react';
import { ExternalLink, FileText, ShieldCheck, X } from 'lucide-react';

export const REAL_TERMS_URL =
  'https://sites.google.com/view/ghosted-terms-and-conditions/home';
export const REAL_PRIVACY_URL =
  'https://sites.google.com/view/ghosted-privacypolicy/home';

export type LegalDocType = 'privacy' | 'terms';

interface LegalModalProps {
  docType: LegalDocType;
  onSwitchDoc: (next: LegalDocType) => void;
  onClose: () => void;
}

export const LegalModal: React.FC<LegalModalProps> = ({
  docType,
  onSwitchDoc,
  onClose,
}) => {
  const isPrivacy = docType === 'privacy';
  const externalUrl = isPrivacy ? REAL_PRIVACY_URL : REAL_TERMS_URL;

  return (
    <div className="fixed inset-0 z-[600] bg-black/90 backdrop-blur-md flex items-center justify-center p-4">
      <div className="w-full max-w-xl max-h-[88vh] flex flex-col rounded-3xl bg-[#120D20] border border-cyan-400/35 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between shrink-0 bg-[#0D0916]">
          <div className="flex items-center space-x-2.5">
            {isPrivacy ? (
              <ShieldCheck className="w-5 h-5 text-cyan-300" />
            ) : (
              <FileText className="w-5 h-5 text-cyan-300" />
            )}
            <div>
              <h2 className="text-base font-black text-white">
                {isPrivacy ? 'Privacy Policy — Ghosted Number' : 'Terms & Conditions — Ghosted Number'}
              </h2>
              <p className="text-[11px] text-zinc-400">Official In-App Legal Document</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="min-w-[40px] min-h-[40px] rounded-full hover:bg-white/10 text-zinc-400 hover:text-white flex items-center justify-center cursor-pointer"
            aria-label="Close legal page"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Switch Tabs */}
        <div className="px-5 pt-3 pb-2 bg-[#0D0916]/60 border-b border-white/10 grid grid-cols-2 gap-2 shrink-0">
          <button
            type="button"
            onClick={() => onSwitchDoc('privacy')}
            className={`min-h-[38px] rounded-xl text-xs font-bold transition cursor-pointer ${
              isPrivacy
                ? 'bg-cyan-400 text-black'
                : 'bg-white/5 text-zinc-300 hover:bg-white/10'
            }`}
          >
            Privacy Policy
          </button>
          <button
            type="button"
            onClick={() => onSwitchDoc('terms')}
            className={`min-h-[38px] rounded-xl text-xs font-bold transition cursor-pointer ${
              !isPrivacy
                ? 'bg-cyan-400 text-black'
                : 'bg-white/5 text-zinc-300 hover:bg-white/10'
            }`}
          >
            Terms &amp; Conditions
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 text-xs text-zinc-300 leading-relaxed">
          {isPrivacy ? (
            <>
              <section className="space-y-1.5">
                <h3 className="text-sm font-black text-white">1. Information We Collect</h3>
                <p>
                  When you use <strong className="text-white">Ghosted Number</strong>, we collect only the
                  information required to provide private GH-Number communication:
                </p>
                <ul className="list-disc pl-5 space-y-1 text-zinc-300">
                  <li>
                    <strong className="text-white">Username &amp; Profile:</strong> Your chosen Display Name,
                    avatar selection, permanent GH-Number (e.g. GH-4821), and optional location text.
                  </li>
                  <li>
                    <strong className="text-white">Email Address:</strong> Used for account authentication
                    (one email is permanently linked to one GH-Number) and deleted-account blocklist protection.
                  </li>
                  <li>
                    <strong className="text-white">Messages &amp; Rooms:</strong> Text messages, friend requests,
                    voice call signaling, game rooms, and accepted map coordinates. Messages, calls, and map
                    sessions automatically delete after 24 hours.
                  </li>
                  <li>
                    <strong className="text-white">Device Info:</strong> Basic browser, OS, IP-region, and
                    connectivity telemetry needed for real-time messaging, WebRTC voice calls, and fraud prevention.
                  </li>
                </ul>
              </section>

              <section className="space-y-1.5">
                <h3 className="text-sm font-black text-white">2. Google AdMob Advertising</h3>
                <p>
                  Ghosted Number displays ads via <strong className="text-white">Google AdMob</strong> for
                  free accounts to keep core features free. AdMob may use device identifiers and cookies to
                  serve and measure advertisements. Users who purchase an active VIP subscription do not see ads
                  for the duration of their paid period.
                </p>
              </section>

              <section className="space-y-1.5">
                <h3 className="text-sm font-black text-white">3. We Do Not Sell Your Data</h3>
                <p>
                  <strong className="text-emerald-300">We never sell, rent, or trade your personal data</strong>{' '}
                  (including your email, username, messages, or location) to third parties or data brokers.
                </p>
              </section>

              <section className="space-y-1.5">
                <h3 className="text-sm font-black text-white">4. Account &amp; Data Deletion</h3>
                <p>
                  You can permanently delete your Ghosted Number account and all stored data (profile, chats,
                  messages, friend requests, location, VIP records, and authentication credentials) at any time
                  from <strong className="text-white">Profile → Delete Account</strong>. Once deleted, your data
                  is permanently wiped and your email is blocked from re-creating accounts.
                </p>
              </section>

              <section className="space-y-1.5">
                <h3 className="text-sm font-black text-white">5. Age Requirement (13+)</h3>
                <p>
                  Ghosted Number is intended strictly for users aged <strong className="text-white">13 years and older</strong>.
                  We do not knowingly collect data from children under 13.
                </p>
              </section>
            </>
          ) : (
            <>
              <section className="space-y-1.5">
                <h3 className="text-sm font-black text-white">1. Eligibility (13+ Only)</h3>
                <p>
                  By creating an account or using <strong className="text-white">Ghosted Number</strong>, you
                  confirm that you are at least <strong className="text-white">13 years of age</strong> and agree
                  to follow these Terms &amp; Conditions and our Privacy Policy.
                </p>
              </section>

              <section className="space-y-1.5">
                <h3 className="text-sm font-black text-white">2. Zero Tolerance: No Harassment or Illegal Content</h3>
                <p>You agree NOT to use Ghosted Number for:</p>
                <ul className="list-disc pl-5 space-y-1 text-zinc-300">
                  <li>Harassment, bullying, stalking, intimidation, hate speech, or threats of violence.</li>
                  <li>Any illegal content, exploitation, scams, phishing, malware, or unlawful activity.</li>
                  <li>Sharing private personal data or non-consensual content without permission.</li>
                  <li>Impersonation, spam, or bypassing friend-request or block protections.</li>
                </ul>
              </section>

              <section className="space-y-1.5">
                <h3 className="text-sm font-black text-white">3. Right to Ban Abusive Users</h3>
                <p>
                  Users may block or delete contacts at any time. We reserve the absolute right to{' '}
                  <strong className="text-rose-300">suspend, terminate, or permanently ban abusive users</strong>{' '}
                  and block their accounts or emails without prior notice if they engage in harassment or post
                  illegal content.
                </p>
              </section>

              <section className="space-y-1.5">
                <h3 className="text-sm font-black text-white">4. Ephemeral Rooms, Ads &amp; VIP Subscriptions</h3>
                <p>
                  Chats, call logs, and map sessions auto-delete after 24 hours. Free accounts are supported by
                  Google AdMob ads. Paid VIP plans and VIP Games passes unlock ad-free benefits and VIP features
                  strictly for their active subscription term.
                </p>
              </section>

              <section className="space-y-1.5">
                <h3 className="text-sm font-black text-white">5. Account Deletion</h3>
                <p>
                  One email is permanently bound to one GH-Number. You may delete your account and all associated
                  data anytime via Profile → Delete Account.
                </p>
              </section>
            </>
          )}
        </div>

        {/* Footer with Real Google Sites Link */}
        <div className="px-5 py-3.5 border-t border-white/10 bg-[#0D0916] flex flex-wrap items-center justify-between gap-2 shrink-0">
          <a
            href={externalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center space-x-1.5 text-xs font-bold text-blue-400 hover:text-blue-300 underline"
          >
            <span>Open Official {isPrivacy ? 'Privacy Policy' : 'Terms & Conditions'}</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>

          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] px-5 rounded-xl bg-[#00F5FF] hover:bg-[#00d8e6] text-black font-black text-xs cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
