'use client';

import React, { useState } from 'react';
import {
  Users,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  X,
  Plus,
  Trash2,
} from 'lucide-react';
import { db } from '@/lib/server/db';
import { StaffManager } from '@/components/settings/StaffManager';
import { getCurrentUserId } from '@/lib/session';

export default function PracticeSettingsPage() {
  const [activeTab, setActiveTab] = useState<'roles' | 'rules'>('roles');
  const [savedToast, setSavedToast] = useState<string | null>(null);

  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const tab = params.get('tab');
      if (tab === 'rules' || tab === 'ai-rules') setActiveTab('rules');
      else if (tab === 'roles' || tab === 'users') setActiveTab('roles');
    }
  }, []);

  // ADM-01 Users & Roles
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'readonly' | 'preparer' | 'reviewer' | 'partner' | 'admin'>('preparer');
  const [inviteScope, setInviteScope] = useState<'all' | 'assigned'>('all');
  const [inviteError, setInviteError] = useState('');
  const [inviteClientIds, setInviteClientIds] = useState<string[]>([]);
  const [inviteLink, setInviteLink] = useState('');
  const [inviteSending, setInviteSending] = useState(false);

  // DAT-09 Shared Rules Library & DAT-05 Mapping Rules
  const [rulesList, setRulesList] = useState<any[]>(() => {
    if (db.learned_rules.length > 0) return [...db.learned_rules];
    return [
      {
        id: 'rule_1',
        firm_id: 'firm_blynt_uk',
        type: 'mapping',
        pattern: '*Plant*Machinery*',
        scope: 'practice',
        target_value: '1500 Plant & Equipment Cost',
        created_by: 'usr_test_reviewer',
        created_by_name: 'Manager',
        created_at: '2026-09-01T10:00:00Z',
        times_used: 412,
        active: true,
        approved_by_manager: true,
      },
      {
        id: 'rule_2',
        firm_id: 'firm_blynt_uk',
        type: 'mapping',
        pattern: '*Director*Loan*',
        scope: 'practice',
        target_value: "835b Director's Loan Account",
        created_by: 'usr_test_reviewer',
        created_by_name: 'Manager',
        created_at: '2026-09-01T10:00:00Z',
        times_used: 285,
        active: true,
        approved_by_manager: true,
      },
      {
        id: 'rule_3',
        firm_id: 'firm_blynt_uk',
        client_id: 'cli_harlow',
        type: 'mapping',
        pattern: '*Barclays*Current*',
        scope: 'client',
        target_value: '1010 Barclays Operating Account',
        created_by: 'usr_test_preparer',
        created_by_name: 'Senior Associate',
        created_at: '2026-09-15T11:00:00Z',
        times_used: 24,
        active: true,
        approved_by_manager: true,
      },
      {
        id: 'rule_4',
        firm_id: 'firm_blynt_uk',
        client_id: 'cli_harlow',
        type: 'mapping',
        pattern: '*Rent*Unit*4*',
        scope: 'client',
        target_value: '6000 London Office Rent and Service',
        created_by: 'usr_test_preparer',
        created_by_name: 'Senior Associate',
        created_at: '2026-09-20T14:30:00Z',
        times_used: 12,
        active: true,
        approved_by_manager: true,
      },
      {
        id: 'rule_5',
        firm_id: 'firm_blynt_uk',
        supplier_name: 'Dell Technologies UK',
        type: 'extraction',
        pattern: '*Dell Technologies*PowerEdge*',
        scope: 'supplier',
        target_value: 'Fixed Assets Addition (Computer equipment)',
        created_by: 'usr_test_reviewer',
        created_by_name: 'Manager',
        created_at: '2026-10-01T09:00:00Z',
        times_used: 18,
        active: true,
        approved_by_manager: true,
      },
      {
        id: 'rule_6',
        firm_id: 'firm_blynt_uk',
        type: 'mapping',
        pattern: '*Software*SaaS*Monthly*',
        scope: 'practice',
        target_value: '6000 Subscriptions & Software',
        created_by: 'usr_test_preparer',
        created_by_name: 'Senior Associate',
        created_at: '2026-10-25T16:00:00Z',
        times_used: 6,
        active: true,
        approved_by_manager: false, // Pending manager approval
      },
    ];
  });
  const [ruleScopeFilter, setRuleScopeFilter] = useState<'all' | 'supplier' | 'client' | 'practice'>('all');
  const [ruleTypeFilter, setRuleTypeFilter] = useState<'all' | 'mapping' | 'extraction' | 'proposal' | 'finding'>('all');
  const [showRuleModal, setShowRuleModal] = useState(false);
  const [newRulePattern, setNewRulePattern] = useState('');
  const [newRuleTarget, setNewRuleTarget] = useState('1500 Plant & Equipment Cost');
  const [newRuleScope, setNewRuleScope] = useState<'supplier' | 'client' | 'practice'>('practice');
  const [newRuleType, setNewRuleType] = useState<'mapping' | 'extraction' | 'proposal' | 'finding'>('mapping');

  const triggerSaveNotification = (msg: string) => {
    setSavedToast(msg);
    setTimeout(() => setSavedToast(null), 3000);
  };

  const closeInviteModal = () => {
    setShowInviteModal(false);
    setInviteName('');
    setInviteEmail('');
    setInviteError('');
    setInviteClientIds([]);
    setInviteLink('');
  };

  // ADM-01: the server records the invite and returns a one-time link for the new user
  const handleSendInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteName.trim() || !inviteEmail.trim() || !inviteEmail.includes('@')) {
      setInviteError('Please provide a valid name and professional email.');
      return;
    }
    const limited = inviteScope === 'assigned' && inviteRole !== 'partner' && inviteRole !== 'admin';
    if (limited && inviteClientIds.length === 0) {
      setInviteError('Choose at least one client, or give access to all clients.');
      return;
    }
    setInviteSending(true);
    setInviteError('');
    try {
      const res = await fetch('/api/v1/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: inviteName.trim(),
          email: inviteEmail.trim(),
          role: inviteRole,
          ...(limited ? { client_ids: inviteClientIds } : {}),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setInviteError(body.error || 'Could not create the invitation.');
        return;
      }
      setInviteLink(body.link);
      triggerSaveNotification(`Invitation created for ${body.invite.email}. Send them the link to finish set-up.`);
    } catch {
      setInviteError('Could not reach the server. Please try again.');
    } finally {
      setInviteSending(false);
    }
  };

  const handleToggleRule = (id: string) => {
    setRulesList((prev) =>
      prev.map((r) => {
        if (r.id === id) {
          const nextActive = !r.active;
          const found = db.learned_rules.find((lr) => lr.id === id);
          if (found) found.active = nextActive;
          return { ...r, active: nextActive };
        }
        return r;
      })
    );
    triggerSaveNotification('Rule status updated.');
  };

  const handleApproveRule = (id: string) => {
    setRulesList((prev) =>
      prev.map((r) => {
        if (r.id === id) {
          const found = db.learned_rules.find((lr) => lr.id === id);
          if (found) found.approved_by_manager = true;
          return { ...r, approved_by_manager: true };
        }
        return r;
      })
    );
    triggerSaveNotification('Rule approved for practice-wide deployment.');
  };

  const handleDeleteRule = (id: string) => {
    setRulesList((prev) => prev.filter((r) => r.id !== id));
    db.learned_rules = db.learned_rules.filter((r) => r.id !== id);
    triggerSaveNotification('Rule deleted.');
  };

  const handleAddRule = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRulePattern.trim()) return;
    const rule = {
      id: `rule_${Date.now()}`,
      firm_id: 'firm_blynt_uk',
      type: newRuleType,
      pattern: newRulePattern.trim(),
      target_value: newRuleTarget,
      scope: newRuleScope,
      created_by: 'usr_test_reviewer',
      created_by_name: 'Manager',
      created_at: new Date().toISOString(),
      times_used: 1,
      active: true,
      approved_by_manager: true,
    };
    db.learned_rules.unshift(rule as any);
    setRulesList([rule, ...rulesList]);
    setShowRuleModal(false);
    setNewRulePattern('');
    triggerSaveNotification(`Rule created for pattern: ${rule.pattern}`);
  };

  return (
    <div className="flex flex-col gap-6 animate-in fade-in duration-200 max-w-7xl mx-auto pb-16">
      {/* Top Banner */}
      <div className="bg-white border border-[#E3E7EF] rounded-[20px] p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-extrabold text-[#122654] tracking-tight">Practice Settings</h1>
            <span className="text-xs bg-[#EAF5FC] text-[#1D4E89] border border-[#1D4E89]/20 px-2.5 py-1 rounded-full font-mono font-bold">
              Blynt Practice &amp; Co LLP
            </span>
          </div>
          <p className="text-xs text-[#4A5878] mt-1.5 leading-relaxed">
            Manage practice team members, roles, permissions, and firm-wide AI mapping and extraction rules.
          </p>
        </div>
      </div>

      {savedToast && (
        <div className="bg-emerald-50 border border-emerald-300 text-emerald-800 text-xs px-4 py-3 rounded-xl flex items-center justify-between shadow-xs animate-in fade-in">
          <div className="flex items-center gap-2 font-medium">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{savedToast}</span>
          </div>
          <button type="button" onClick={() => setSavedToast(null)} className="text-emerald-700 hover:text-emerald-900 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Tabs Navigation: Users & Roles and AI Rules & Accuracy */}
      <div className="flex items-center gap-2 border-b border-[#E3E7EF] pb-1 overflow-x-auto">
        <button
          id="tab-roles"
          type="button"
          onClick={() => setActiveTab('roles')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold border-b-2 transition-all shrink-0 cursor-pointer ${
            activeTab === 'roles'
              ? 'border-[#FF7A66] text-[#122654] bg-[#F5F8FD]/50 rounded-t-lg'
              : 'border-transparent text-[#4A5878] hover:text-[#122654]'
          }`}
        >
          <Users className="w-4 h-4 text-[#1D4E89]" />
          <span>Users &amp; Roles</span>
        </button>

        <button
          id="tab-rules"
          type="button"
          onClick={() => setActiveTab('rules')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold border-b-2 transition-all shrink-0 cursor-pointer ${
            activeTab === 'rules'
              ? 'border-[#FF7A66] text-[#122654] bg-[#F5F8FD]/50 rounded-t-lg'
              : 'border-transparent text-[#4A5878] hover:text-[#122654]'
          }`}
        >
          <Sparkles className="w-4 h-4 text-[#FF7A66]" />
          <span>AI Rules &amp; Accuracy</span>
        </button>
      </div>

      {/* TAB 1: Users & Roles (ADM-01) */}
      {activeTab === 'roles' && (
        <div className="bg-white border border-[#E3E7EF] rounded-[20px] shadow-xs p-6 sm:p-8 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#E3E7EF] pb-4">
            <div>
              <h2 className="text-base font-bold text-[#122654]">Team Roles &amp; Permissions</h2>
              <p className="text-xs text-[#4A5878] mt-0.5">
                Practice users with role-based permissions: Preparer, Reviewer/Manager, Partner, and Admin.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowInviteModal(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-[#122654] hover:bg-[#1D4E89] text-white text-xs font-bold rounded-xl shadow-xs transition-colors cursor-pointer self-start sm:self-auto"
            >
              <Plus className="w-3.5 h-3.5 text-[#FF7A66]" />
              <span>Invite Team Member</span>
            </button>
          </div>

          <StaffManager currentUserId={getCurrentUserId()} />
        </div>
      )}

      {/* TAB 2: Shared Rules Library & AI Accuracy (DAT-09, DAT-05, ADM-02) */}
      {activeTab === 'rules' && (
        <div className="bg-white border border-[#E3E7EF] rounded-[20px] shadow-xs p-6 sm:p-8 space-y-8">
          {/* Header */}
          <div className="border-b border-[#E3E7EF] pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2.5">
                <h2 className="text-base font-bold text-[#122654]">Shared Rules Library</h2>
                <span className="text-[10px] font-mono font-bold bg-[#EAF5FC] text-[#1D4E89] px-2 py-0.5 rounded-full border border-[#1D4E89]/20">
                  Rules run before AI
                </span>
              </div>
              <p className="text-xs text-[#4A5878] mt-0.5">
                Every correction is learned and becomes a rule at supplier, client or practice scope. Target accuracy: &gt;90%.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setShowRuleModal(true)}
                className="flex items-center gap-1.5 px-4 py-2 bg-[#122654] hover:bg-[#1D4E89] text-white text-xs font-bold rounded-xl shadow-xs transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5 text-[#FF7A66]" />
                <span>Add Rule</span>
              </button>
            </div>
          </div>

          {/* AI Performance & Confidence Gate Card (DAT-08, DAT-05, RPT-03) */}
          <div className="bg-[#F5F8FD] border border-[#E3E7EF] rounded-xl p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <span className="text-xs font-bold text-[#122654] flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-[#FF7A66]" />
                  AI Accuracy Performance &amp; Auto-Accept Controls
                </span>
                <p className="text-[11px] text-[#4A5878] mt-0.5">
                  Auto-accept is OFF at launch. Requires 3 consecutive months ≥90% accepted without change.
                </p>
              </div>
              <span className="text-xs font-mono font-bold text-emerald-800 bg-emerald-100 border border-emerald-300 px-3 py-1 rounded-full w-max">
                Overall Accuracy: 94.2% (Target: ≥90%)
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="bg-white p-3 rounded-xl border border-gray-200">
                <div className="text-[10px] uppercase font-bold text-[#7E8DA6]">Account Mapping</div>
                <div className="text-lg font-mono font-bold text-emerald-700 mt-1">94.2%</div>
                <div className="text-[10px] text-gray-500 mt-0.5">Auto-accept: OFF (Month 1/3)</div>
              </div>
              <div className="bg-white p-3 rounded-xl border border-gray-200">
                <div className="text-[10px] uppercase font-bold text-[#7E8DA6]">Document Extraction</div>
                <div className="text-lg font-mono font-bold text-emerald-700 mt-1">91.5%</div>
                <div className="text-[10px] text-gray-500 mt-0.5">Auto-accept: OFF (Month 1/3)</div>
              </div>
              <div className="bg-white p-3 rounded-xl border border-gray-200">
                <div className="text-[10px] uppercase font-bold text-[#7E8DA6]">Proposed Journals</div>
                <div className="text-lg font-mono font-bold text-amber-700 mt-1">89.2%</div>
                <div className="text-[10px] text-gray-500 mt-0.5">Auto-accept: OFF (&lt;90%)</div>
              </div>
              <div className="bg-white p-3 rounded-xl border border-gray-200">
                <div className="text-[10px] uppercase font-bold text-[#7E8DA6]">Review Findings</div>
                <div className="text-lg font-mono font-bold text-emerald-700 mt-1">95.8%</div>
                <div className="text-[10px] text-gray-500 mt-0.5">Auto-accept: OFF (Month 2/3)</div>
              </div>
            </div>
          </div>

          {/* Pending Manager Approvals Queue (DAT-09 criteria 5) */}
          {rulesList.some((r) => r.scope === 'practice' && !r.approved_by_manager) && (
            <div className="border border-amber-300 bg-amber-50/60 rounded-xl p-5 space-y-3">
              <div className="flex items-center gap-2 text-xs font-bold text-amber-900">
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                <span>Manager Approval Queue (Practice-Scope Rules Requested by Preparers)</span>
              </div>
              <p className="text-[11px] text-amber-800 leading-relaxed">
                Practice-wide rules created by preparers require manager or partner approval before applying across all client files.
              </p>
              <div className="space-y-2 pt-1">
                {rulesList
                  .filter((r) => r.scope === 'practice' && !r.approved_by_manager)
                  .map((rule) => (
                    <div
                      key={rule.id}
                      className="bg-white p-3.5 rounded-xl border border-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                    >
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono font-bold text-[#122654] bg-[#F5F8FD] px-2 py-0.5 rounded">
                            {rule.pattern}
                          </span>
                          <span>&rarr;</span>
                          <span className="font-bold text-[#1D4E89]">{rule.target_value}</span>
                        </div>
                        <div className="text-[10px] text-[#7E8DA6] mt-1">
                          Requested by {rule.created_by_name} • Scope: Practice-wide
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleApproveRule(rule.id)}
                          className="px-3 py-1.5 bg-[#0B6B52] hover:bg-[#095742] text-white text-xs font-bold rounded-lg shadow-2xs cursor-pointer"
                        >
                          Approve for Practice
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteRule(rule.id)}
                          className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold rounded-lg cursor-pointer"
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* Filter Bar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-[#4A5878] font-semibold text-[11px]">Scope:</span>
              {(['all', 'practice', 'client', 'supplier'] as const).map((sc) => (
                <button
                  key={sc}
                  type="button"
                  onClick={() => setRuleScopeFilter(sc)}
                  className={`px-3 py-1 rounded-full text-xs font-semibold capitalize transition-all cursor-pointer ${
                    ruleScopeFilter === sc
                      ? 'bg-[#122654] text-white'
                      : 'bg-[#F5F8FD] text-[#4A5878] hover:text-[#122654]'
                  }`}
                >
                  {sc}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-[#4A5878] font-semibold text-[11px]">Type:</span>
              {(['all', 'mapping', 'extraction', 'proposal', 'finding'] as const).map((tp) => (
                <button
                  key={tp}
                  type="button"
                  onClick={() => setRuleTypeFilter(tp)}
                  className={`px-3 py-1 rounded-full text-xs font-semibold capitalize transition-all cursor-pointer ${
                    ruleTypeFilter === tp
                      ? 'bg-[#1D4E89] text-white'
                      : 'bg-[#F5F8FD] text-[#4A5878] hover:text-[#122654]'
                  }`}
                >
                  {tp}
                </button>
              ))}
            </div>
          </div>

          {/* Rules List */}
          <div className="space-y-3">
            {rulesList
              .filter((r) => ruleScopeFilter === 'all' || r.scope.toLowerCase() === ruleScopeFilter)
              .filter((r) => ruleTypeFilter === 'all' || r.type === ruleTypeFilter)
              .map((r) => (
                <div
                  key={r.id}
                  className={`p-4 rounded-xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs ${
                    r.active ? 'border-[#E3E7EF] bg-[#F5F8FD]/70' : 'border-gray-200 bg-gray-50 opacity-60'
                  }`}
                >
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-bold text-[#122654] bg-white px-2.5 py-1 rounded-lg border border-gray-200 shadow-2xs">
                        {r.pattern}
                      </span>
                      <span className="text-[#7E8DA6]">&rarr;</span>
                      <span className="font-bold text-[#1D4E89]">{r.target_value}</span>
                    </div>
                    <div className="text-[11px] text-[#4A5878] mt-1.5 flex items-center gap-3 flex-wrap">
                      <span className="capitalize">
                        Scope: <strong className="text-[#122654]">{r.scope}</strong>
                      </span>
                      <span>•</span>
                      <span className="capitalize">
                        Type: <strong className="text-[#122654]">{r.type}</strong>
                      </span>
                      <span>•</span>
                      <span>
                        Used: <strong className="text-[#122654]">{r.times_used || 1} times</strong>
                      </span>
                      <span>•</span>
                      <span>Created by: {r.created_by_name || 'Staff'}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleToggleRule(r.id)}
                      className={`text-[10px] font-bold px-3 py-1 rounded-full cursor-pointer transition-colors ${
                        r.active
                          ? 'text-emerald-800 bg-emerald-100 hover:bg-emerald-200'
                          : 'text-gray-600 bg-gray-200 hover:bg-gray-300'
                      }`}
                    >
                      {r.active ? 'Active' : 'Disabled'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteRule(r.id)}
                      className="text-gray-400 hover:text-red-600 p-1 rounded cursor-pointer"
                      title="Delete rule"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Invite User Modal (ADM-01) */}
      {showInviteModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-[#0B1A3B]/50 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in"
        >
          <div className="bg-white border border-[#E3E7EF] rounded-[24px] shadow-2xl max-w-md w-full p-6 sm:p-8 animate-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-[#E3E7EF] mb-4">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-[#1D4E89]" />
                <h3 className="text-base font-bold text-[#122654]">Invite Team Member</h3>
              </div>
              <button
                type="button"
                onClick={closeInviteModal}
                aria-label="Close"
                className="text-[#4A5878] hover:text-[#122654] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSendInvite} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#122654] mb-1">
                  Full Name <span className="text-red-500">*</span>
                </label>
                <input aria-label="Full name"
                  type="text"
                  placeholder="e.g. Alex Montgomery"
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                  className="w-full text-xs p-2.5 border border-[#D3DCEE] rounded-lg focus:ring-1 focus:ring-[#1D4E89] outline-none text-[#122654]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#122654] mb-1">
                  Email Address <span className="text-red-500">*</span>
                </label>
                <input aria-label="Work email"
                  type="email"
                  placeholder="e.g. alex.montgomery@blynt.co.uk"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="w-full text-xs p-2.5 border border-[#D3DCEE] rounded-lg focus:ring-1 focus:ring-[#1D4E89] outline-none text-[#122654]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#122654] mb-1">
                  Role &amp; Signing Authority
                </label>
                <select aria-label="Role & Signing Authority"
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as any)}
                  className="w-full text-xs p-2.5 bg-[#F5F8FD] border border-[#D3DCEE] rounded-lg text-[#122654] font-medium"
                >
                  <option value="readonly">Read only (View assigned files, no changes)</option>
                  <option value="preparer">Preparer (Reconcile &amp; prepare schedules)</option>
                  <option value="reviewer">Manager / Reviewer (Review schedules &amp; raise points)</option>
                  <option value="partner">Partner (Final sign-off, approval &amp; lock)</option>
                  <option value="admin">Practice Admin (All permissions &amp; firm setup)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#122654] mb-1">
                  Client Access
                </label>
                <div className="flex items-center gap-4 text-xs pt-1">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="scope"
                      checked={inviteScope === 'all'}
                      onChange={() => setInviteScope('all')}
                    />
                    <span>All Practice Clients</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="scope"
                      checked={inviteScope === 'assigned'}
                      onChange={() => setInviteScope('assigned')}
                    />
                    <span>Assigned Clients Only</span>
                  </label>
                </div>
                {inviteScope === 'assigned' && (inviteRole === 'partner' || inviteRole === 'admin') && (
                  <p className="text-[11px] text-[#4A5878] mt-2">Partners and admins always see every client.</p>
                )}
                {inviteScope === 'assigned' && inviteRole !== 'partner' && inviteRole !== 'admin' && (
                  <div className="mt-2 max-h-36 overflow-y-auto border border-[#D3DCEE] rounded-lg p-2 space-y-1.5">
                    {db.clients.map((c) => (
                      <label key={c.id} className="flex items-center gap-2 text-xs cursor-pointer text-[#122654]">
                        <input
                          type="checkbox"
                          checked={inviteClientIds.includes(c.id)}
                          onChange={(e) =>
                            setInviteClientIds((ids) => (e.target.checked ? [...ids, c.id] : ids.filter((x) => x !== c.id)))
                          }
                        />
                        <span>{c.name}</span>
                      </label>
                    ))}
                    {db.clients.length === 0 && <p className="text-[11px] text-[#4A5878]">No clients yet.</p>}
                  </div>
                )}
              </div>

              {inviteError && <p className="text-red-600 text-[11px] font-semibold">{inviteError}</p>}

              {inviteLink && (
                <div className="p-3 rounded-lg bg-[#EAF6F0] border border-[#0B6B52]/20 text-xs text-[#122654] space-y-2">
                  <p className="font-semibold">Invitation created. Send this link to {inviteEmail.trim()} (valid for 7 days):</p>
                  <input aria-label="Invite link" readOnly value={inviteLink} onFocus={(e) => e.target.select()} className="w-full font-mono text-[11px] p-2 border border-[#D3DCEE] rounded bg-white" />
                  <button type="button" onClick={() => navigator.clipboard?.writeText(inviteLink)} className="text-[#1D4E89] font-semibold hover:underline cursor-pointer">
                    Copy link
                  </button>
                </div>
              )}

              <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-[#E3E7EF]">
                <button
                  type="button"
                  onClick={closeInviteModal}
                  className="px-3.5 py-2 text-xs text-[#4A5878] hover:text-[#122654] font-medium cursor-pointer"
                >
                  {inviteLink ? 'Done' : 'Cancel'}
                </button>
                {!inviteLink && (
                  <button
                    type="submit"
                    disabled={inviteSending}
                    className="px-4 py-2 bg-[#122654] hover:bg-[#1D4E89] text-white text-xs font-bold rounded-lg shadow-xs transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {inviteSending ? 'Creating...' : 'Create Invitation'}
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Mapping Rule Modal (DAT-05) */}
      {showRuleModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-[#0B1A3B]/50 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in"
        >
          <div className="bg-white border border-[#E3E7EF] rounded-[24px] shadow-2xl max-w-md w-full p-6 sm:p-8 animate-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-[#E3E7EF] mb-4">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-[#FF7A66]" />
                <h3 className="text-base font-bold text-[#122654]">Add Learned Mapping Rule</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowRuleModal(false)}
                className="text-[#4A5878] hover:text-[#122654] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddRule} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#122654] mb-1">
                  Rule Type
                </label>
                <select aria-label="Rule Type"
                  value={newRuleType}
                  onChange={(e) => setNewRuleType(e.target.value as any)}
                  className="w-full text-xs p-2.5 bg-[#F5F8FD] border border-[#D3DCEE] rounded-lg text-[#122654] font-medium"
                >
                  <option value="mapping">Account Mapping Rule</option>
                  <option value="extraction">Document Extraction Rule</option>
                  <option value="proposal">Schedule / Journal Proposal Rule</option>
                  <option value="finding">Review Finding Rule</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#122654] mb-1">
                  Matching Pattern (Wildcard matching)
                </label>
                <input aria-label="Matching Pattern (Wildcard matching)"
                  type="text"
                  placeholder="e.g. *Software*Subscription* or *Dell*PowerEdge*"
                  value={newRulePattern}
                  onChange={(e) => setNewRulePattern(e.target.value)}
                  className="w-full text-xs p-2.5 border border-[#D3DCEE] rounded-lg font-mono focus:ring-1 focus:ring-[#1D4E89] outline-none text-[#122654]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#122654] mb-1">
                  Target Value / Classification
                </label>
                <select aria-label="Target Value / Classification"
                  value={newRuleTarget}
                  onChange={(e) => setNewRuleTarget(e.target.value)}
                  className="w-full text-xs p-2.5 bg-[#F5F8FD] border border-[#D3DCEE] rounded-lg text-[#122654] font-medium"
                >
                  <option value="1500 Plant & Equipment Cost">1500 Plant &amp; Equipment Cost</option>
                  <option value="1510 Computer Equipment Cost">1510 Computer Equipment Cost</option>
                  <option value="1010 Barclays Operating Account">1010 Barclays Operating Account</option>
                  <option value="6000 London Office Rent and Service">6000 London Office Rent and Service</option>
                  <option value="6200 Staff Salaries">6200 Staff Salaries</option>
                  <option value="835b Director's Loan Account">835b Director&apos;s Loan Account</option>
                  <option value="2000 Purchase Ledger Control Account">2000 Purchase Ledger Control Account</option>
                  <option value="Capital Addition">Capital Addition</option>
                  <option value="Lease Agreement">Lease Agreement</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#122654] mb-1">
                  Rule Scope
                </label>
                <select aria-label="Rule Scope"
                  value={newRuleScope}
                  onChange={(e) => setNewRuleScope(e.target.value as any)}
                  className="w-full text-xs p-2.5 bg-[#F5F8FD] border border-[#D3DCEE] rounded-lg text-[#122654] font-medium"
                >
                  <option value="practice">Whole Practice (Requires Manager Approval)</option>
                  <option value="client">Client Only (Harlow &amp; Finch Fine Goods Ltd)</option>
                  <option value="supplier">Specific Supplier / Vendor</option>
                </select>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-[#E3E7EF]">
                <button
                  type="button"
                  onClick={() => setShowRuleModal(false)}
                  className="px-3.5 py-2 text-xs text-[#4A5878] hover:text-[#122654] font-medium cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-[#122654] hover:bg-[#1D4E89] text-white text-xs font-bold rounded-lg shadow-xs transition-colors cursor-pointer"
                >
                  Create Rule
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
