'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  Building2,
  Users,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  X,
  Plus,
  Trash2,
  Save,
  Check,
  ShieldCheck,
  Briefcase,
  MapPin,
  FileCheck2,
} from 'lucide-react';
import { db } from '@/lib/server/db';
import { StaffManager } from '@/components/settings/StaffManager';
import { getCurrentUserId } from '@/lib/session';

export default function PracticeSettingsPage() {
  const [activeTab, setActiveTab] = useState<'company' | 'roles' | 'rules'>('company');
  const [savedToast, setSavedToast] = useState<string | null>(null);

  // Company Profile & Details (Basic company settings)
  const [legalName, setLegalName] = useState('Blynt Practice & Co LLP');
  const [tradingName, setTradingName] = useState('Blynt Practice & Co');
  const [structure, setStructure] = useState<'llp' | 'ltd' | 'partnership' | 'sole'>('llp');
  const [companyNumber, setCompanyNumber] = useState('OC394812');
  const [addressLine, setAddressLine] = useState('128 City Road, London');
  const [postcode, setPostcode] = useState('EC1V 2NX');
  const [jurisdiction, setJurisdiction] = useState<'england_wales' | 'scotland' | 'northern_ireland'>('england_wales');
  const [regulator, setRegulator] = useState<'ICAEW' | 'ACCA' | 'ICAS' | 'CAI' | 'AAT' | 'CIMA' | 'ATT' | 'CIOT'>('ICAEW');
  const [registrationNumber, setRegistrationNumber] = useState('C003847291');
  const [vatRegistered, setVatRegistered] = useState(true);
  const [vatNumber, setVatNumber] = useState('GB 849 2048 11');
  const [phone, setPhone] = useState('+44 20 7946 0192');
  const [contactEmail, setContactEmail] = useState('admin@blynt.co.uk');

  // Basic Operational Defaults
  const [signOffLevels, setSignOffLevels] = useState<'3' | '2'>('3');
  const [reconciliationTolerance, setReconciliationTolerance] = useState('1.00');
  const [reviewThreshold, setReviewThreshold] = useState('500.00');
  const [savingCompany, setSavingCompany] = useState(false);

  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const tab = params.get('tab');
      if (tab === 'rules' || tab === 'ai-rules') setActiveTab('rules');
      else if (tab === 'roles' || tab === 'users') setActiveTab('roles');
      else if (tab === 'company' || tab === 'firm' || tab === 'practice') setActiveTab('company');
    }

    // Load firm profile
    fetch('/api/v1/firm/onboarding')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        const p = d.profile;
        if (p) {
          if (p.legal_name) setLegalName(p.legal_name);
          if (p.trading_name) setTradingName(p.trading_name);
          if (p.structure) setStructure(p.structure);
          if (p.company_number) setCompanyNumber(p.company_number);
          if (p.address_line) setAddressLine(p.address_line);
          if (p.postcode) setPostcode(p.postcode);
          if (p.jurisdiction) setJurisdiction(p.jurisdiction);
          if (p.regulator) setRegulator(p.regulator);
          if (p.registration_number) setRegistrationNumber(p.registration_number);
          if (typeof p.vat_registered === 'boolean') setVatRegistered(p.vat_registered);
          if (p.vat_number) setVatNumber(p.vat_number);
          if (p.phone) setPhone(p.phone);
        } else if (d.firm_name) {
          setLegalName(d.firm_name);
        }
      })
      .catch(() => {});

    // Load firm defaults
    fetch('/api/v1/firm/settings')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d?.defaults) return;
        setSignOffLevels(d.defaults.signoff_levels === 2 ? '2' : '3');
        setReconciliationTolerance((Number(d.defaults.tolerance_p) / 100).toFixed(2));
        setReviewThreshold((Number(d.defaults.review_threshold_p) / 100).toFixed(2));
      })
      .catch(() => {});
  }, []);

  const triggerSaveNotification = (msg: string) => {
    setSavedToast(msg);
    setTimeout(() => setSavedToast(null), 3000);
  };

  const handleSaveCompanySettings = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!legalName.trim()) {
      triggerSaveNotification('Please enter the legal company name.');
      return;
    }
    setSavingCompany(true);
    try {
      // 1. Save company profile via onboarding step 0
      const profRes = await fetch('/api/v1/firm/onboarding', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          step: 0,
          data: {
            legal_name: legalName.trim(),
            trading_name: tradingName.trim() || undefined,
            structure,
            company_number: (structure === 'llp' || structure === 'ltd') ? companyNumber.trim().toUpperCase() : undefined,
            address_line: addressLine.trim(),
            postcode: postcode.trim().toUpperCase(),
            jurisdiction,
            regulator,
            registration_number: registrationNumber.trim() || undefined,
            vat_registered: vatRegistered,
            vat_number: vatRegistered ? vatNumber.trim().toUpperCase() : undefined,
            phone: phone.trim() || undefined,
          },
        }),
      });

      if (!profRes.ok) {
        const err = await profRes.json().catch(() => ({}));
        triggerSaveNotification(err.error || 'Failed to save company profile.');
        setSavingCompany(false);
        return;
      }

      // 2. Save basic operational defaults
      const defRes = await fetch('/api/v1/firm/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tolerance: reconciliationTolerance,
          review_threshold: reviewThreshold,
          signoff_levels: Number(signOffLevels),
        }),
      });

      if (!defRes.ok) {
        const err = await defRes.json().catch(() => ({}));
        triggerSaveNotification(err.error || 'Company details saved, but defaults failed.');
      } else {
        triggerSaveNotification('Company settings saved successfully.');
      }
    } catch {
      triggerSaveNotification('Network error while saving company settings.');
    } finally {
      setSavingCompany(false);
    }
  };

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
        approved_by_manager: false,
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

  const closeInviteModal = () => {
    setShowInviteModal(false);
    setInviteName('');
    setInviteEmail('');
    setInviteError('');
    setInviteClientIds([]);
    setInviteLink('');
  };

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
            <h1 className="text-2xl font-extrabold text-[#122654] tracking-tight">Practice &amp; Company Settings</h1>
            <span className="text-xs bg-[#EAF5FC] text-[#1D4E89] border border-[#1D4E89]/20 px-2.5 py-1 rounded-full font-mono font-bold">
              {legalName || 'Blynt Practice & Co LLP'}
            </span>
          </div>
          <p className="text-xs text-[#4A5878] mt-1.5 leading-relaxed">
            Manage company profile, legal entity details, team roles, and firm-wide AI extraction and mapping rules.
          </p>
        </div>

        {activeTab === 'company' && (
          <button
            type="button"
            onClick={() => handleSaveCompanySettings()}
            disabled={savingCompany}
            className="flex items-center gap-2 px-5 py-2.5 bg-[#122654] hover:bg-[#1D4E89] text-white text-xs font-bold rounded-xl shadow-xs transition-all cursor-pointer shrink-0 disabled:opacity-50"
          >
            <Save className="w-4 h-4 text-[#FF7A66]" />
            <span>{savingCompany ? 'Saving...' : 'Save Settings'}</span>
          </button>
        )}
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

      {/* Tabs Navigation: Company Settings, Users & Roles, and AI Rules & Accuracy */}
      <div className="flex items-center gap-2 border-b border-[#E3E7EF] pb-1 overflow-x-auto">
        <button
          id="tab-company"
          type="button"
          onClick={() => setActiveTab('company')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold border-b-2 transition-all shrink-0 cursor-pointer ${
            activeTab === 'company'
              ? 'border-[#FF7A66] text-[#122654] bg-[#F5F8FD]/50 rounded-t-lg'
              : 'border-transparent text-[#4A5878] hover:text-[#122654]'
          }`}
        >
          <Building2 className="w-4 h-4 text-[#1D4E89]" />
          <span>Company Settings</span>
        </button>

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

        <Link
          id="tab-ai-control"
          href="/settings/ai"
          className="flex items-center gap-2 px-4 py-2.5 text-xs font-bold border-b-2 border-transparent text-[#4A5878] hover:text-[#122654] transition-all shrink-0"
        >
          <Sparkles className="w-4 h-4 text-[#1D4E89]" />
          <span>AI Control Centre</span>
        </Link>
      </div>

      {/* TAB 1: Company Settings (Basic settings the company uses) */}
      {activeTab === 'company' && (
        <form onSubmit={handleSaveCompanySettings} className="space-y-6 max-w-5xl">
          {/* Card 1: Company Identity */}
          <div className="bg-white border border-[#E3E7EF] rounded-[20px] shadow-xs p-6 sm:p-8 space-y-6">
            <div className="flex items-center gap-2.5 border-b border-[#E3E7EF] pb-4">
              <Briefcase className="w-5 h-5 text-[#1D4E89]" />
              <div>
                <h2 className="text-base font-bold text-[#122654]">Company &amp; Legal Identity</h2>
                <p className="text-xs text-[#4A5878] mt-0.5">
                  Official practice identity used on engagement letters, statutory accounts headers, and lead sheets.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div>
                <label className="block text-xs font-bold text-[#122654] mb-1.5">
                  Legal Practice / Company Name <span className="text-[#FF7A66]">*</span>
                </label>
                <input
                  type="text"
                  value={legalName}
                  onChange={(e) => setLegalName(e.target.value)}
                  placeholder="e.g. Blynt Practice & Co LLP"
                  className="w-full text-xs p-3 bg-[#F5F8FD] border border-[#D3DCEE] rounded-xl font-bold text-[#122654] focus:ring-2 focus:ring-[#1D4E89]/20 outline-none"
                  required
                />
                <span className="text-[11px] text-[#7E8DA6] mt-1 block">
                  Registered name as it appears on official filings.
                </span>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#122654] mb-1.5">
                  Trading / Brand Name
                </label>
                <input
                  type="text"
                  value={tradingName}
                  onChange={(e) => setTradingName(e.target.value)}
                  placeholder="e.g. Blynt Practice & Co"
                  className="w-full text-xs p-3 bg-[#F5F8FD] border border-[#D3DCEE] rounded-xl font-medium text-[#122654] focus:ring-2 focus:ring-[#1D4E89]/20 outline-none"
                />
                <span className="text-[11px] text-[#7E8DA6] mt-1 block">
                  Optional trading name displayed to staff and clients.
                </span>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#122654] mb-1.5">
                  Legal Entity Structure <span className="text-[#FF7A66]">*</span>
                </label>
                <select
                  value={structure}
                  onChange={(e) => setStructure(e.target.value as any)}
                  className="w-full text-xs p-3 bg-[#F5F8FD] border border-[#D3DCEE] rounded-xl font-bold text-[#122654] focus:ring-2 focus:ring-[#1D4E89]/20 outline-none"
                >
                  <option value="llp">Limited Liability Partnership (LLP)</option>
                  <option value="ltd">Limited Company (Ltd)</option>
                  <option value="partnership">General Partnership</option>
                  <option value="sole">Sole Practitioner</option>
                </select>
                <span className="text-[11px] text-[#7E8DA6] mt-1 block">
                  LLPs and Limited Companies require Companies House registration.
                </span>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#122654] mb-1.5">
                  Companies House Number {(structure === 'llp' || structure === 'ltd') && <span className="text-[#FF7A66]">*</span>}
                </label>
                <input
                  type="text"
                  value={companyNumber}
                  onChange={(e) => setCompanyNumber(e.target.value)}
                  disabled={structure === 'sole' || structure === 'partnership'}
                  placeholder={structure === 'llp' ? 'e.g. OC394812' : 'e.g. 12345678'}
                  className="w-full text-xs p-3 bg-[#F5F8FD] border border-[#D3DCEE] rounded-xl font-mono font-bold text-[#122654] focus:ring-2 focus:ring-[#1D4E89]/20 outline-none disabled:opacity-50"
                />
                <span className="text-[11px] text-[#7E8DA6] mt-1 block">
                  {structure === 'sole' || structure === 'partnership'
                    ? 'Not applicable for sole practitioners and general partnerships.'
                    : 'Registered company number on the UK Companies House register.'}
                </span>
              </div>
            </div>
          </div>

          {/* Card 2: Registered Office & Contact */}
          <div className="bg-white border border-[#E3E7EF] rounded-[20px] shadow-xs p-6 sm:p-8 space-y-6">
            <div className="flex items-center gap-2.5 border-b border-[#E3E7EF] pb-4">
              <MapPin className="w-5 h-5 text-[#1D4E89]" />
              <div>
                <h2 className="text-base font-bold text-[#122654]">Registered Office &amp; Contact Details</h2>
                <p className="text-xs text-[#4A5878] mt-0.5">
                  Official registered office address for statutory disclosures and practice correspondence.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div className="sm:col-span-2">
                <label className="block text-xs font-bold text-[#122654] mb-1.5">
                  Registered Office Street Address <span className="text-[#FF7A66]">*</span>
                </label>
                <input
                  type="text"
                  value={addressLine}
                  onChange={(e) => setAddressLine(e.target.value)}
                  placeholder="e.g. 128 City Road, London"
                  className="w-full text-xs p-3 bg-[#F5F8FD] border border-[#D3DCEE] rounded-xl font-medium text-[#122654] focus:ring-2 focus:ring-[#1D4E89]/20 outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#122654] mb-1.5">
                  UK Postcode <span className="text-[#FF7A66]">*</span>
                </label>
                <input
                  type="text"
                  value={postcode}
                  onChange={(e) => setPostcode(e.target.value)}
                  placeholder="e.g. EC1V 2NX"
                  className="w-full text-xs p-3 bg-[#F5F8FD] border border-[#D3DCEE] rounded-xl font-mono font-bold text-[#122654] focus:ring-2 focus:ring-[#1D4E89]/20 outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#122654] mb-1.5">
                  Country / Jurisdiction <span className="text-[#FF7A66]">*</span>
                </label>
                <select
                  value={jurisdiction}
                  onChange={(e) => setJurisdiction(e.target.value as any)}
                  className="w-full text-xs p-3 bg-[#F5F8FD] border border-[#D3DCEE] rounded-xl font-bold text-[#122654] focus:ring-2 focus:ring-[#1D4E89]/20 outline-none"
                >
                  <option value="england_wales">England &amp; Wales</option>
                  <option value="scotland">Scotland</option>
                  <option value="northern_ireland">Northern Ireland</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#122654] mb-1.5">
                  Official Practice Phone
                </label>
                <input
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="e.g. +44 20 7946 0192"
                  className="w-full text-xs p-3 bg-[#F5F8FD] border border-[#D3DCEE] rounded-xl font-medium text-[#122654] focus:ring-2 focus:ring-[#1D4E89]/20 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#122654] mb-1.5">
                  Primary Practice Email
                </label>
                <input
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  placeholder="e.g. admin@blynt.co.uk"
                  className="w-full text-xs p-3 bg-[#F5F8FD] border border-[#D3DCEE] rounded-xl font-medium text-[#122654] focus:ring-2 focus:ring-[#1D4E89]/20 outline-none"
                />
              </div>
            </div>
          </div>

          {/* Card 3: Regulatory & Tax Details */}
          <div className="bg-white border border-[#E3E7EF] rounded-[20px] shadow-xs p-6 sm:p-8 space-y-6">
            <div className="flex items-center gap-2.5 border-b border-[#E3E7EF] pb-4">
              <ShieldCheck className="w-5 h-5 text-[#1D4E89]" />
              <div>
                <h2 className="text-base font-bold text-[#122654]">Supervisory Body &amp; Tax Credentials</h2>
                <p className="text-xs text-[#4A5878] mt-0.5">
                  Professional accountancy regulator and UK VAT registration details.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div>
                <label className="block text-xs font-bold text-[#122654] mb-1.5">
                  Supervisory / Regulatory Body <span className="text-[#FF7A66]">*</span>
                </label>
                <select
                  value={regulator}
                  onChange={(e) => setRegulator(e.target.value as any)}
                  className="w-full text-xs p-3 bg-[#F5F8FD] border border-[#D3DCEE] rounded-xl font-bold text-[#122654] focus:ring-2 focus:ring-[#1D4E89]/20 outline-none"
                >
                  <option value="ICAEW">ICAEW (Institute of Chartered Accountants in England &amp; Wales)</option>
                  <option value="ACCA">ACCA (Association of Chartered Certified Accountants)</option>
                  <option value="ICAS">ICAS (Institute of Chartered Accountants of Scotland)</option>
                  <option value="CAI">CAI (Chartered Accountants Ireland)</option>
                  <option value="AAT">AAT (Association of Accounting Technicians)</option>
                  <option value="CIMA">CIMA (Chartered Institute of Management Accountants)</option>
                  <option value="ATT">ATT (Association of Taxation Technicians)</option>
                  <option value="CIOT">CIOT (Chartered Institute of Taxation)</option>
                </select>
                <span className="text-[11px] text-[#7E8DA6] mt-1 block">
                  Designated Anti-Money Laundering (AML) supervisory body.
                </span>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#122654] mb-1.5">
                  Practice Certificate / Firm Number
                </label>
                <input
                  type="text"
                  value={registrationNumber}
                  onChange={(e) => setRegistrationNumber(e.target.value)}
                  placeholder="e.g. C003847291"
                  className="w-full text-xs p-3 bg-[#F5F8FD] border border-[#D3DCEE] rounded-xl font-mono font-bold text-[#122654] focus:ring-2 focus:ring-[#1D4E89]/20 outline-none"
                />
                <span className="text-[11px] text-[#7E8DA6] mt-1 block">
                  Firm registration code with your professional institute.
                </span>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#122654] mb-1.5">
                  VAT Registration Status
                </label>
                <div className="flex items-center gap-3 pt-1">
                  <label className="flex items-center gap-2 text-xs font-bold text-[#122654] cursor-pointer">
                    <input
                      type="radio"
                      name="vat_reg"
                      checked={vatRegistered}
                      onChange={() => setVatRegistered(true)}
                    />
                    <span>VAT Registered Firm</span>
                  </label>
                  <label className="flex items-center gap-2 text-xs font-bold text-[#122654] cursor-pointer">
                    <input
                      type="radio"
                      name="vat_reg"
                      checked={!vatRegistered}
                      onChange={() => setVatRegistered(false)}
                    />
                    <span>Not Registered</span>
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#122654] mb-1.5">
                  UK VAT Number {vatRegistered && <span className="text-[#FF7A66]">*</span>}
                </label>
                <input
                  type="text"
                  value={vatNumber}
                  onChange={(e) => setVatNumber(e.target.value)}
                  disabled={!vatRegistered}
                  placeholder="e.g. GB 849 2048 11"
                  className="w-full text-xs p-3 bg-[#F5F8FD] border border-[#D3DCEE] rounded-xl font-mono font-bold text-[#122654] focus:ring-2 focus:ring-[#1D4E89]/20 outline-none disabled:opacity-50"
                />
                <span className="text-[11px] text-[#7E8DA6] mt-1 block">
                  9-digit UK VAT registration number prefixed with GB.
                </span>
              </div>
            </div>
          </div>

          {/* Card 4: Basic Operational Defaults */}
          <div className="bg-white border border-[#E3E7EF] rounded-[20px] shadow-xs p-6 sm:p-8 space-y-6">
            <div className="flex items-center gap-2.5 border-b border-[#E3E7EF] pb-4">
              <FileCheck2 className="w-5 h-5 text-[#1D4E89]" />
              <div>
                <h2 className="text-base font-bold text-[#122654]">Standard Operational Defaults</h2>
                <p className="text-xs text-[#4A5878] mt-0.5">
                  Baseline working paper parameters and sign-off hierarchy used by default on all client files.
                </p>
              </div>
            </div>

            <div className="space-y-5">
              <div>
                <label className="block text-xs font-bold text-[#122654] mb-2">
                  Default Sign-off Workflow Hierarchy
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <label
                    className={`flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-all ${
                      signOffLevels === '3'
                        ? 'border-[#122654] bg-[#F5F8FD] shadow-xs'
                        : 'border-[#E3E7EF] hover:border-gray-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name="signOff"
                      checked={signOffLevels === '3'}
                      onChange={() => setSignOffLevels('3')}
                      className="mt-0.5"
                    />
                    <div>
                      <div className="font-bold text-[#122654]">3 Levels: Preparer &gt; Manager &gt; Partner</div>
                      <div className="text-[11px] text-[#4A5878] mt-0.5">
                        Standard UK segregation of duties with manager clearance required before partner sign-off.
                      </div>
                    </div>
                  </label>

                  <label
                    className={`flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-all ${
                      signOffLevels === '2'
                        ? 'border-[#122654] bg-[#F5F8FD] shadow-xs'
                        : 'border-[#E3E7EF] hover:border-gray-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name="signOff"
                      checked={signOffLevels === '2'}
                      onChange={() => setSignOffLevels('2')}
                      className="mt-0.5"
                    />
                    <div>
                      <div className="font-bold text-[#122654]">2 Levels: Preparer &gt; Partner</div>
                      <div className="text-[11px] text-[#4A5878] mt-0.5">
                        Streamlined review workflow suitable for sole practitioners and fast-turnaround teams.
                      </div>
                    </div>
                  </label>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
                <div className="p-4 bg-[#F5F8FD] rounded-xl border border-[#E3E7EF]">
                  <label className="block text-xs font-bold text-[#122654] mb-1">
                    Reconciliation Tolerance (£)
                  </label>
                  <input
                    type="text"
                    value={reconciliationTolerance}
                    onChange={(e) => setReconciliationTolerance(e.target.value)}
                    className="w-full text-xs p-2.5 bg-white border border-[#D3DCEE] rounded-lg font-mono font-bold text-[#122654] focus:ring-1 focus:ring-[#1D4E89] outline-none"
                  />
                  <span className="text-[11px] text-[#7E8DA6] mt-1 block">
                    Differences within tolerance are auto-reconciled.
                  </span>
                </div>

                <div className="p-4 bg-[#F5F8FD] rounded-xl border border-[#E3E7EF]">
                  <label className="block text-xs font-bold text-[#122654] mb-1">
                    Review Threshold (£)
                  </label>
                  <input
                    type="text"
                    value={reviewThreshold}
                    onChange={(e) => setReviewThreshold(e.target.value)}
                    className="w-full text-xs p-2.5 bg-white border border-[#D3DCEE] rounded-lg font-mono font-bold text-[#122654] focus:ring-1 focus:ring-[#1D4E89] outline-none"
                  />
                  <span className="text-[11px] text-[#7E8DA6] mt-1 block">
                    Movements above this are flagged for review.
                  </span>
                </div>

                <div className="p-4 bg-[#F5F8FD] rounded-xl border border-[#E3E7EF]">
                  <label className="block text-xs font-bold text-[#122654] mb-1">
                    Base Currency
                  </label>
                  <div className="w-full text-xs p-2.5 bg-white border border-[#D3DCEE] rounded-lg font-bold text-[#122654] flex items-center justify-between">
                    <span>GBP (£)</span>
                    <span className="text-[10px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded font-mono font-bold">Standard</span>
                  </div>
                  <span className="text-[11px] text-[#7E8DA6] mt-1 block">
                    UK Sterling currency standard.
                  </span>
                </div>
              </div>
            </div>

            {/* Save Button */}
            <div className="flex items-center justify-end pt-4 border-t border-[#E3E7EF]">
              <button
                type="submit"
                disabled={savingCompany}
                className="flex items-center gap-2 px-6 py-2.5 bg-[#122654] hover:bg-[#1D4E89] text-white text-xs font-bold rounded-xl shadow-xs transition-all cursor-pointer disabled:opacity-50"
              >
                <Save className="w-4 h-4 text-[#FF7A66]" />
                <span>{savingCompany ? 'Saving...' : 'Save Company Settings'}</span>
              </button>
            </div>
          </div>
        </form>
      )}

      {/* TAB 2: Users & Roles (ADM-01) */}
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

      {/* TAB 3: Shared Rules Library & AI Accuracy (DAT-09, DAT-05, ADM-02) */}
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
