import React, { useState } from 'react';
import { Building2, LockKeyhole, LogOut, Smartphone, WifiOff } from 'lucide-react';
import { localHubRuntime } from '@plugos/core';
import type { NativeHubOperatorContext } from '@plugos/core';
import { Branch, StaffMember } from '../types';
import { NativeHubEnrollmentControl } from './NativeHubEnrollmentControl';
import { NativeStaffCredentialResetControl } from './NativeStaffCredentialResetControl';

interface RoleLoginModalProps {
  staffList?: StaffMember[];
  branches?: Branch[];
  businessId?: string;
  branchId?: string;
  onSelectBranch?: (branchId: string) => void;
  onOpenNativeStation?: (role: NativeHubOperatorContext['role']) => void;
  onSignOut?: () => void;
}

const OperatorMark = () => (
  <span className="plug-operator-mark" aria-hidden="true">
    <i /><i /><i /><i />
  </span>
);

/**
 * Deliberately does not accept a PIN in a browser. Browser storage, an owner
 * Supabase JWT, and an undeployed R002 RPC are not a staff authorization path.
 * The native session screen replaces this only after the signed-bundle and
 * local credential-verifier flow are deployed.
 */
export const RoleLoginModal: React.FC<RoleLoginModalProps> = ({
  staffList = [],
  branches = [],
  businessId,
  branchId,
  onSelectBranch,
  onOpenNativeStation,
  onSignOut
}) => {
  const activeBranches = branches.filter((branch) => branch.isActive);
  const activeBranch = activeBranches.find((branch) => branch.id === branchId) || activeBranches[0];
  const branchName = activeBranch?.name || 'Branch not ready';
  const [nativeMessage, setNativeMessage] = useState<string | null>(null);
  const [openingNativeSignIn, setOpeningNativeSignIn] = useState(false);
  const [openingNativeStation, setOpeningNativeStation] = useState(false);

  const openNativeSignIn = async () => {
    setOpeningNativeSignIn(true);
    setNativeMessage(null);
    try {
      await localHubRuntime.openNativeStaffSignIn();
      setNativeMessage('Native staff sign-in opened. Select your name and enter the PIN on the Android screen only.');
    } catch (error) {
      setNativeMessage(error instanceof Error ? error.message : 'The native staff sign-in screen could not be opened.');
    } finally {
      setOpeningNativeSignIn(false);
    }
  };

  const openNativeStation = async () => {
    if (!onOpenNativeStation) return;
    setOpeningNativeStation(true);
    setNativeMessage(null);
    try {
      // This is a native-only capability check. It deliberately does not pass
      // a staff identifier, PIN, session token, or role from the browser.
      const context = await localHubRuntime.getNativeOperatorContext();
      onOpenNativeStation(context.role);
    } catch (error) {
      setNativeMessage(error instanceof Error ? error.message : 'Complete native staff sign-in before opening the station.');
    } finally {
      setOpeningNativeStation(false);
    }
  };

  return (
    <div className="plug-operator-gate">
      <section className="plug-operator-card" aria-labelledby="operator-gate-title">
        <aside className="plug-operator-intro">
          <div className="plug-operator-brand">
            <OperatorMark />
            <span>ThePlugOS</span>
          </div>

          <div className="plug-operator-intro-copy">
            <p>Station access</p>
            <h1 id="operator-gate-title">Staff access belongs to the native Hub.</h1>
            <span>
              The web shell can show owner-authorized setup data, but it cannot verify a staff PIN,
              create a staff session, or operate a branch station.
            </span>
          </div>

          <div className="plug-operator-context">
            <div>
              <Building2 aria-hidden="true" />
              <span><small>Active branch</small><strong>{branchName}</strong></span>
            </div>
            <div>
              <WifiOff aria-hidden="true" />
              <span><small>Browser state</small><strong>Read-only cloud shell</strong></span>
            </div>
            <div>
              <LockKeyhole aria-hidden="true" />
              <span><small>Staff authority</small><strong>Not available in a browser</strong></span>
            </div>
          </div>
        </aside>

        <div className="plug-operator-form-side">
          <header>
            <p>Next operational step</p>
            <h2>Open the enrolled Android Cashier Hub.</h2>
          </header>

          <div className="plug-operator-empty" role="status" aria-live="polite">
            <Smartphone aria-hidden="true" />
            <div>
              <strong>Native staff-session flow</strong>
              <span>
                {staffList.length
                  ? `${staffList.length} staff profiles are visible from the cloud directory, but none may be selected here.`
                  : 'No browser-stored staff profile is treated as a station identity.'}
              </span>
            </div>
          </div>

          <p className="mt-5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs leading-relaxed text-amber-100">
            The Android Hub holds the signed authorization bundle and PIN/session verifier. This browser cannot select a staff identity or become a Cashier, Kitchen, or Manager station.
          </p>

          {businessId && branchId && (
            <div className="mt-5">
              {activeBranches.length > 1 && onSelectBranch && (
                <label className="mb-3 grid gap-1 text-xs font-semibold text-slate-300">
                  Owner branch context
                  <select
                    value={activeBranch?.id || branchId}
                    onChange={(event) => onSelectBranch(event.target.value)}
                    className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-normal text-slate-100 outline-none focus:border-emerald-400"
                  >
                    {activeBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                  </select>
                </label>
              )}
              <NativeHubEnrollmentControl businessId={businessId} branchId={branchId} branchName={branchName} compact />
              <div className="mt-4">
                <NativeStaffCredentialResetControl businessId={businessId} branchId={branchId} staff={staffList} compact />
              </div>
            </div>
          )}

          <button className="plug-station-submit mt-5" type="button" onClick={() => void openNativeSignIn()} disabled={openingNativeSignIn}>
            <span>
              <small>Android Cashier Hub</small>
              <strong>{openingNativeSignIn ? 'Opening native staff sign-in…' : 'Open native staff sign-in'}</strong>
            </span>
            <Smartphone aria-hidden="true" />
          </button>

          {onOpenNativeStation && (
            <button className="plug-station-submit mt-3" type="button" onClick={() => void openNativeStation()} disabled={openingNativeStation}>
              <span>
                <small>After native sign-in</small>
                <strong>{openingNativeStation ? 'Checking native session…' : 'Open native station'}</strong>
              </span>
              <Smartphone aria-hidden="true" />
            </button>
          )}

          {nativeMessage && <p className="mt-3 rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs leading-relaxed text-slate-300" role="status">{nativeMessage}</p>}

          {onSignOut && (
            <button className="plug-station-submit mt-5" type="button" onClick={onSignOut}>
              <span>
                <small>Browser session</small>
                <strong>Sign out of this business</strong>
              </span>
              <LogOut aria-hidden="true" />
            </button>
          )}
        </div>
      </section>
    </div>
  );
};
