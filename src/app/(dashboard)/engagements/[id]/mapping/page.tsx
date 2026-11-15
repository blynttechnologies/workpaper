'use client';

import { Fragment, useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  Check,
  Search,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  ArrowRight,
  Lock,
  Unlock,
  X,
} from 'lucide-react';
import { db } from '@/lib/server/db';
import { AccountMapping, LearnedRule } from '@/lib/types/models';
import { asPence, formatPence } from '@/lib/money';
import { getStatutoryDetails } from '@/lib/mapping/auto-mapper';
import { whyNotConfirmed } from '@/lib/mapping/why';
import { getActor } from '@/lib/session';
import { engagementSummary } from '@/lib/api';
import { NewAccountForm } from '@/components/coa/NewAccountForm';
import { AccountPicker } from '@/components/coa/AccountPicker';
import { groupMappings } from '@/lib/mapping/group';
import { nameShape, similarLines } from '@/lib/mapping/similar';

function ChartOptions({ engagementId }: { engagementId: string }) {
  return (
    <>
      {db.accountsFor(engagementId).map((a) => (
        <option key={a.code} value={a.code}>
          {a.code} {a.name}
        </option>
      ))}
    </>
  );
}

export default function AccountMappingPage() {
  const params = useParams();
  const engagementId = (params?.id as string) || 'eng_harlow_fy26';
  const engagementRow = db.engagements.find((e) => e.id === engagementId);
  const firmId = engagementRow?.firm_id ?? 'firm_blynt_uk';
  const engagementClientId = engagementRow?.client_id ?? null;
  const clientName = db.clients.find((c) => c.id === engagementClientId)?.name ?? 'this client';

  const [mappings, setMappings] = useState<AccountMapping[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<'all' | 'ready' | 'check' | 'exception' | 'confirmed'>('all');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'amount' | 'code'>('amount');
  const [activeDetailId, setActiveDetailId] = useState<string | null>(null);
  const [typeFilter] = useState('all');
  const [statutoryFilter] = useState('all');
  const [showStatutory, setShowStatutory] = useState(false);
  const [showReason, setShowReason] = useState(false);
  const [batchTargetCode, setBatchTargetCode] = useState('');
  const [correctionToast, setCorrectionToast] = useState<{ message: string; undoAction?: () => void } | null>(null);

  // Rule creation modal (DAT-09)
  const [ruleModalOpen, setRuleModalOpen] = useState(false);
  const [pendingCorrection, setPendingCorrection] = useState<{
    mappingId: string;
    sourceCode: string;
    sourceName: string;
    sourceType: string;
    targetCode: string;
    pattern: string;
  } | null>(null);
  const [ruleScope, setRuleScope] = useState<'client' | 'practice'>('client');
  // Other lines the correction is also applied to, chosen in the rule pop-up
  const [alsoApply, setAlsoApply] = useState<string[]>([]);

  // Load from db
  const reloadData = () => {
    const list = db.account_mappings.filter((m) => m.engagement_id === engagementId);
    // Ledger code order, as on the trial balance (numeric, so 200 comes before 1000)
    setMappings([...list].sort((a, b) => a.source_code.localeCompare(b.source_code, undefined, { numeric: true })));
  };

  useEffect(() => {
    reloadData();
  }, [engagementId]);

  // The AI system reads every unconfirmed line and suggests an account; each stays a suggestion until someone confirms it
  const [aiBusy, setAiBusy] = useState(false);
  const [creatingFor, setCreatingFor] = useState<string | null>(null);
  const mapWithAi = async () => {
    const open = db.account_mappings.filter((m) => m.engagement_id === engagementId && m.status !== 'confirmed');
    if (!open.length) {
      setCorrectionToast({ message: 'Every line is already confirmed.' });
      setTimeout(() => setCorrectionToast(null), 4000);
      return;
    }
    setAiBusy(true);
    try {
      const res = await fetch('/api/v1/ai/suggest-mapping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ engagementId, all: true, items: open.map((m) => ({ id: m.id, name: m.source_name, type: m.source_type, code: m.source_code, balance_p: m.balance_p })) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'The AI could not map the lines. Try again.');
      if (!body.ai) {
        setCorrectionToast({ message: body.note || 'AI is not switched on for this practice. An admin can turn it on in the AI Control Centre.' });
        return;
      }
      const actor = getActor();
      let changed = 0;
      let toCreate = 0;
      for (const r of body.results as { id: string; suggested_blynt_code: string | null; confidence: number; reason: string; source: string; model?: string; new_account?: { name: string; parent_code: string } | null }[]) {
        const m = db.account_mappings.find((x) => x.id === r.id && x.status !== 'confirmed');
        if (!m || r.source !== 'ai') continue;
        // Nothing in the chart fits: the line waits for someone to create the proposed account, or pick one
        if (!r.suggested_blynt_code && r.new_account) {
          Object.assign(m, {
            blynt_code: null,
            status: 'needs_you',
            confidence: 0,
            method: 'ai',
            ai_reason: `AI: ${r.reason}`,
            evidence_used: r.model ? `AI model ${r.model}` : 'AI',
            gate: 'exception',
            ai_new_account: r.new_account,
            sign_mismatch: false,
          });
          toCreate++;
          continue;
        }
        if (!r.suggested_blynt_code) continue;
        m.ai_new_account = null;
        const stat = getStatutoryDetails(r.suggested_blynt_code, m.source_name, m.source_type);
        const bal = asPence(m.balance_p);
        if (m.blynt_code !== r.suggested_blynt_code) changed++;
        Object.assign(m, {
          blynt_code: r.suggested_blynt_code,
          status: 'suggested',
          confidence: r.confidence,
          method: 'ai',
          ai_reason: `AI: ${r.reason}`,
          evidence_used: r.model ? `AI model ${r.model}` : 'AI',
          gate: r.confidence >= 90 ? 'ready' : r.confidence >= 70 ? 'check' : 'exception',
          statutory_line: stat.statutory_line,
          schedule_ref: stat.schedule_ref,
          cash_flow_category: stat.cash_flow_category,
          sign_mismatch: (stat.is_credit_area && bal > 0n) || (!stat.is_credit_area && bal < 0n),
        });
      }
      db.logAudit(firmId, actor, 'AI_MAPPING_SUGGESTED', 'engagements', engagementId, null, { lines: open.length, changed, to_create: toCreate, model: body.model });
      reloadData();
      setCorrectionToast({
        message: `AI read ${open.length} unconfirmed lines and changed the suggestion on ${changed}${toCreate ? `; ${toCreate} fit no chart account and have a new account to create` : ''}. AI lines are marked ✦ AI: check them, then confirm.`,
      });
    } catch (err) {
      setCorrectionToast({ message: (err as Error).message });
    } finally {
      setAiBusy(false);
      setTimeout(() => setCorrectionToast(null), 8000);
    }
  };

  // Confidence Gate calculations (DAT-03, DAT-08)
  const totalImported = mappings.length;
  const confirmedCount = mappings.filter((m) => m.status === 'confirmed').length;

  const readyList = useMemo(() => {
    return mappings.filter(
      (m) => m.status !== 'confirmed' && (m.gate === 'ready' || (m.confidence >= 90 && m.blynt_code))
    );
  }, [mappings]);

  const checkList = useMemo(() => {
    return mappings.filter(
      (m) =>
        m.status !== 'confirmed' &&
        (m.gate === 'check' || (m.confidence >= 70 && m.confidence < 90 && m.blynt_code))
    );
  }, [mappings]);

  const exceptionList = useMemo(() => {
    return mappings.filter(
      (m) =>
        m.status !== 'confirmed' &&
        (m.gate === 'exception' || m.confidence < 70 || !m.blynt_code || m.sign_mismatch)
    );
  }, [mappings]);

  const readyCount = readyList.length;
  const checkCount = checkList.length;
  const exceptionCount = exceptionList.length;

  // Unmapped balance strictly calculated via BigInt (Ground Rule 2)
  const unmappedBalancePence = mappings
    .filter((m) => m.status !== 'confirmed')
    .reduce((acc, m) => acc + asPence(m.balance_p), 0n);

  const isFullyMapped = unmappedBalancePence === 0n && totalImported > 0;

  // Filtered list
  const filteredMappings = useMemo(() => {
    return mappings.filter((m) => {
      const matchSearch =
        m.source_code.toLowerCase().includes(search.toLowerCase()) ||
        m.source_name.toLowerCase().includes(search.toLowerCase()) ||
        (m.blynt_code || '').toLowerCase().includes(search.toLowerCase()) ||
        (m.statutory_line || '').toLowerCase().includes(search.toLowerCase()) ||
        (m.schedule_ref || '').toLowerCase().includes(search.toLowerCase());

      const matchType = typeFilter === 'all' || m.source_type.toLowerCase() === typeFilter.toLowerCase();
      const matchStat =
        statutoryFilter === 'all' ||
        (m.statutory_line || '').toLowerCase().includes(statutoryFilter.toLowerCase());

      if (!matchSearch || !matchType || !matchStat) return false;

      if (activeTab === 'ready') return m.status !== 'confirmed' && (m.gate === 'ready' || (m.confidence >= 90 && m.blynt_code));
      if (activeTab === 'check') return m.status !== 'confirmed' && (m.gate === 'check' || (m.confidence >= 70 && m.confidence < 90 && m.blynt_code));
      if (activeTab === 'exception') return m.status !== 'confirmed' && (m.gate === 'exception' || m.confidence < 70 || !m.blynt_code || m.sign_mismatch);
      if (activeTab === 'confirmed') return m.status === 'confirmed';
      return true;
    });
  }, [mappings, search, typeFilter, statutoryFilter, activeTab]);
  const groups = useMemo(() => groupMappings(filteredMappings, sortBy), [filteredMappings, sortBy]);
  const columns = 6 + (showStatutory ? 1 : 0) + (showReason ? 1 : 0);
  const canApprove = ['manager', 'partner', 'admin'].includes(getActor().role);
  const patternsHint = alsoApply.length ? `these ${alsoApply.length + 1} accounts` : 'this account';
  // Lines that look like the one being corrected, offered in the rule pop-up
  const similar = useMemo(() => {
    const item = pendingCorrection && mappings.find((m) => m.id === pendingCorrection.mappingId);
    return item ? similarLines(item, mappings).filter((s) => !(s.line.status === 'confirmed' && s.line.blynt_code === pendingCorrection!.targetCode)) : [];
  }, [pendingCorrection, mappings]);

  // Active detail mapping for slide-over facts (DAT-03 UI step 3)
  const detailMapping = mappings.find((m) => m.id === activeDetailId) || null;
  const [pickCode, setPickCode] = useState('');
  useEffect(() => {
    setPickCode(detailMapping?.blynt_code ?? '');
  }, [activeDetailId]);

  // Selection handlers (DAT-04)
  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleSelectAllVisible = () => {
    if (selectedIds.length === filteredMappings.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredMappings.map((m) => m.id));
    }
  };

  // DAT-04: Single action confirms all Ready mappings
  const handleConfirmAllReady = () => {
    const readyIds = readyList.map((m) => m.id);
    if (readyIds.length === 0) return;

    const actor = getActor();
    const now = new Date().toISOString();

    setMappings((prev) =>
      prev.map((m) =>
        readyIds.includes(m.id)
          ? {
              ...m,
              status: 'confirmed' as const,
              confirmed_by: actor.id,
              confirmed_at: now,
            }
          : m
      )
    );

    // Sync to db and record in AI log (AUD-03) and audit log (AUD-01)
    readyIds.forEach((id) => {
      const item = db.account_mappings.find((m) => m.id === id);
      if (item) {
        item.status = 'confirmed';
        item.confirmed_by = actor.id;
        item.confirmed_at = now;

        // Log AI action
        db.ai_action_logs.push({
          id: `ail_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          firm_id: firmId,
          engagement_id: engagementId,
          output_type: 'mapping',
          inputs_used: `${item.source_code} ${item.source_name}`,
          confidence: item.confidence,
          model_version: 'gpt-4o-accountant-v1.1',
          outcome: 'accepted',
          decided_by: actor.id,
          decided_by_name: actor.name,
          decided_at: now,
        });

        // Audit log entry
        db.logAudit(
          firmId,
          actor,
          'CONFIRM_MAPPING',
          'account_mappings',
          item.id,
          null,
          { source_code: item.source_code, blynt_code: item.blynt_code, gate: 'ready' }
        );
      }
    });

    setCorrectionToast({
      message: `Confirmed ${readyIds.length} Ready account mappings.`,
    });
    setTimeout(() => setCorrectionToast(null), 3500);
    setSelectedIds((prev) => prev.filter((id) => !readyIds.includes(id)));
  };

  const why = (m: AccountMapping) => whyNotConfirmed(m, db.blynt_accounts.find((a) => a.code === m.blynt_code)?.name);

  // Confirm selected Check or filtered items
  const handleConfirmSelected = () => confirmMappings(selectedIds);
  const confirmMappings = (ids: string[]) => {
    // Only a mapping with no chart account cannot be confirmed; say which, and why
    const validIds = ids.filter((id) => {
      const m = db.account_mappings.find((x) => x.id === id);
      return m && m.blynt_code;
    });
    const skipped = ids
      .map((id) => db.account_mappings.find((x) => x.id === id))
      .filter((m): m is AccountMapping => !!m && !m.blynt_code)
      .map((m) => m.source_name || m.source_code);
    if (validIds.length === 0) {
      setCorrectionToast({ message: skipped.length ? `Not confirmed: ${skipped.join(', ')}. No chart account is chosen yet; pick one, then confirm.` : 'Select the accounts to confirm first.' });
      setTimeout(() => setCorrectionToast(null), 5000);
      return;
    }

    const actor = getActor();
    const now = new Date().toISOString();

    setMappings((prev) =>
      prev.map((m) =>
        validIds.includes(m.id)
          ? {
              ...m,
              status: 'confirmed' as const,
              confirmed_by: actor.id,
              confirmed_at: now,
            }
          : m
      )
    );

    validIds.forEach((id) => {
      const item = db.account_mappings.find((m) => m.id === id);
      if (item) {
        item.status = 'confirmed';
        item.confirmed_by = actor.id;
        item.confirmed_at = now;

        db.ai_action_logs.push({
          id: `ail_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          firm_id: firmId,
          engagement_id: engagementId,
          output_type: 'mapping',
          inputs_used: `${item.source_code} ${item.source_name}`,
          confidence: item.confidence,
          model_version: 'gpt-4o-accountant-v1.1',
          outcome: 'accepted',
          decided_by: actor.id,
          decided_by_name: actor.name,
          decided_at: now,
        });

        db.logAudit(
          firmId,
          actor,
          'CONFIRM_MAPPING',
          'account_mappings',
          item.id,
          null,
          { source_code: item.source_code, blynt_code: item.blynt_code }
        );
      }
    });

    setCorrectionToast({
      message: `Confirmed ${validIds.length} mapping${validIds.length === 1 ? '' : 's'}.${skipped.length ? ` Not confirmed: ${skipped.join(', ')} (no chart account chosen yet).` : ''}`,
    });
    setTimeout(() => setCorrectionToast(null), skipped.length ? 5000 : 3500);
    setSelectedIds((prev) => prev.filter((id) => !validIds.includes(id)));
  };

  // Initiate mapping correction (opens DAT-09 rule pop-over modal)
  const handleInitiateChangeMapping = (mappingId: string, newBlyntCode: string) => {
    const item = db.account_mappings.find((m) => m.id === mappingId);
    if (!item) return;

    // A client rule keys on the client's own nominal code, which stays the same from year to year
    // even if the account is renamed; a practice rule keys on the whole name, since codes differ between clients
    const pattern = `name:${item.source_name}`;
    // Lines with the same name but for codes ("Route 52 Wages" beside "Route 2V Wages") are ticked to follow
    const lines = db.account_mappings.filter((m) => m.engagement_id === engagementId);
    setAlsoApply(similarLines(item, lines).filter((s) => s.alike && !(s.line.status === 'confirmed' && s.line.blynt_code === newBlyntCode)).map((s) => s.line.id));

    setPendingCorrection({
      mappingId,
      sourceCode: item.source_code,
      sourceName: item.source_name,
      sourceType: item.source_type,
      targetCode: newBlyntCode,
      pattern,
    });
    setRuleModalOpen(true);
  };

  // Execute Rule Creation and Apply Correction (DAT-09, DAT-05)
  const handleSaveCorrectionWithRule = () => {
    if (!pendingCorrection) return;
    const { mappingId, sourceName, targetCode, pattern } = pendingCorrection;
    const actor = getActor();
    const now = new Date().toISOString();
    const targetAcc = db.blynt_accounts.find((b) => b.code === targetCode);
    const statDetails = getStatutoryDetails(targetCode, sourceName);

    // The other lines ticked in the pop-up take the same account, confirmed by this person
    const others = db.account_mappings.filter((m) => m.engagement_id === engagementId && m.id !== mappingId && alsoApply.includes(m.id));
    const appliedCount = 1 + others.length;

    // 1. Create the rule in db.learned_rules (DAT-09). A client rule keys on each nominal code; a practice
    // rule on the name, with codes as * when lines differing only by code were applied too
    const shape = nameShape(sourceName);
    const patterns =
      ruleScope === 'client'
        ? [pendingCorrection.sourceCode, ...others.map((m) => m.source_code)].map((c) => `code:${c}`)
        : [shape.includes('*') && others.some((m) => nameShape(m.source_name) === shape) ? `name:${shape}` : pattern];
    const createdRuleIds: string[] = [];
    patterns.forEach((rulePattern, i) => {
      const newRule: LearnedRule = {
        id: `rule_${Date.now()}_${i}`,
        firm_id: firmId,
        client_id: ruleScope === 'client' ? engagementClientId : null,
        supplier_name: null,
        type: 'mapping',
        scope: ruleScope,
        pattern: rulePattern,
        target_value: targetCode,
        explanation: `Rule learned from correction on ${sourceName} → ${targetCode} ${targetAcc?.name ?? ''}`,
        created_by: actor.id,
        created_by_name: actor.name,
        created_at: now,
        times_used: 1,
        // Practice rules wait for a manager (DAT-09); the server refuses anything else
        active: ruleScope !== 'practice' || ['manager', 'partner', 'admin'].includes(actor.role),
        approved_by_manager: ruleScope === 'practice' ? ['manager', 'partner', 'admin'].includes(actor.role) : true,
      };
      db.learned_rules.unshift(newRule);
      createdRuleIds.push(newRule.id);
      db.logAudit(firmId, actor, 'CREATE_LEARNED_RULE', 'learned_rules', newRule.id, null, newRule);
    });

    for (const m of others) {
      const before = { ...m };
      const stat = getStatutoryDetails(targetCode, m.source_name);
      Object.assign(m, {
        blynt_code: targetCode,
        status: 'confirmed',
        confidence: 100,
        method: 'manual',
        ai_reason: `Applied with the correction to ${sourceName}`,
        ai_new_account: null,
        gate: 'ready',
        statutory_line: stat.statutory_line,
        schedule_ref: stat.schedule_ref,
        cash_flow_category: stat.cash_flow_category,
        confirmed_by: actor.id,
        confirmed_at: now,
      });
      db.logAudit(firmId, actor, 'UPDATE_MAPPING_WITH_RULE', 'account_mappings', m.id, before, { ...m, appliedWith: mappingId });
    }

    // 2. Update the target mapping
    const item = db.account_mappings.find((m) => m.id === mappingId);
    if (item) {
      const before = { ...item };
      item.blynt_code = targetCode;
      item.status = 'confirmed';
      item.confidence = 100;
      item.method = 'manual';
      item.statutory_line = statDetails.statutory_line;
      item.schedule_ref = statDetails.schedule_ref;
      item.cash_flow_category = statDetails.cash_flow_category;
      item.confirmed_by = actor.id;
      item.confirmed_at = now;
      item.gate = 'ready';
      item.ai_new_account = null;

      // Log to AI Action Log (AUD-03)
      db.ai_action_logs.push({
        id: `ail_${Date.now()}`,
        firm_id: firmId,
        engagement_id: engagementId,
        output_type: 'mapping',
        inputs_used: `${item.source_code} ${item.source_name}`,
        confidence: item.confidence,
        model_version: 'gpt-4o-accountant-v1.1',
        outcome: 'edited',
        decided_by: actor.id,
        decided_by_name: actor.name,
        decided_at: now,
      });

      db.logAudit(
        firmId,
        actor,
        'UPDATE_MAPPING_WITH_RULE',
        'account_mappings',
        item.id,
        before,
        { ...item, ruleScope, rulePattern: pattern }
      );
    }

    reloadData();
    setRuleModalOpen(false);
    setPendingCorrection(null);

    // Toast with Undo (DAT-05 UI step 1)
    setCorrectionToast({
      message: `${targetCode} applied to ${appliedCount} account${appliedCount === 1 ? '' : 's'}. ${
        ruleScope === 'client' ? `Remembered for ${clientName}.` : canApprove ? 'Remembered for every client.' : 'The practice rule waits for a manager to approve it.'
      }`,
      undoAction: () => {
        db.learned_rules = db.learned_rules.filter((r) => !createdRuleIds.includes(r.id));
        reloadData();
        setCorrectionToast({ message: 'Rule undone.' });
      },
    });
    setTimeout(() => setCorrectionToast(null), 4500);
  };

  // Batch remap selected accounts
  const handleApplyBatchRemap = () => {
    if (!batchTargetCode || selectedIds.length === 0) return;
    const actor = getActor();
    const now = new Date().toISOString();
    const targetAcc = db.blynt_accounts.find((b) => b.code === batchTargetCode);
    const statDetails = getStatutoryDetails(batchTargetCode);

    selectedIds.forEach((id) => {
      const item = db.account_mappings.find((m) => m.id === id);
      if (item) {
        const before = { ...item };
        item.blynt_code = batchTargetCode;
        item.status = 'confirmed';
        item.confidence = 100;
        item.method = 'manual';
        item.statutory_line = statDetails.statutory_line;
        item.schedule_ref = statDetails.schedule_ref;
        item.cash_flow_category = statDetails.cash_flow_category;
        item.confirmed_by = actor.id;
        item.confirmed_at = now;
        item.gate = 'ready';

        db.logAudit(
          firmId,
          actor,
          'BATCH_MAP_ACCOUNTS',
          'account_mappings',
          item.id,
          before,
          item
        );
      }
    });

    reloadData();
    setCorrectionToast({
      message: `Mapped and confirmed ${selectedIds.length} accounts to ${batchTargetCode} ${targetAcc?.name ?? ''}.`,
    });
    setTimeout(() => setCorrectionToast(null), 3500);
    setSelectedIds([]);
    setBatchTargetCode('');
  };

  return (
    <div className="flex flex-col gap-6 w-full min-w-0 pb-16 animate-in fade-in duration-200">
      {/* Header with Title and v1.1 Breadcrumbs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-[#4A5878] mb-1">
            <Link href="/" className="hover:text-[#FF7A66] transition-colors">Blynt</Link>
            <span>/</span>
            <span className="text-[#122654] font-semibold">{engagementSummary(engagementId).clientName}</span>
            <span>/</span>
            <span>Step 4 Account mapping</span>
          </div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-[#122654] tracking-tight">
              Account mapping &amp; Confidence Gate
            </h1>
          </div>
          <p className="text-xs text-[#4A5878] mt-1 max-w-3xl leading-relaxed">
            Every nominal account is mapped to a statutory line, schedule, and cash flow category. Rules engine runs first (client &gt; practice &gt; prior-year), followed by the AI confidence gate.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href={`/engagements/${engagementId}/workpapers`}
            className={`min-h-[42px] px-5 py-2 text-xs font-bold rounded-xl flex items-center gap-2 transition-all ${
              isFullyMapped
                ? 'bg-[#0B6B52] hover:bg-[#095742] text-white shadow-xs'
                : 'bg-[#F5F8FD] text-[#4A5878] border border-[#D3DCEE]'
            }`}
          >
            {isFullyMapped ? <Unlock className="w-4 h-4 text-emerald-300" /> : <Lock className="w-4 h-4" />}
            <span>Go to working paper</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>

      {/* Confidence Gate Summary Strip (DAT-03, DAT-08) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
        {/* READY GATE */}
        <div className="bg-white border-2 border-emerald-500/30 rounded-xl p-4 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-xs font-bold text-emerald-800">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                Ready (≥90%)
              </span>
              <span className="text-[10px] bg-emerald-100 text-emerald-900 px-2 py-0.5 rounded-full font-mono">
                Gate: Ready
              </span>
            </div>
            <div className="text-2xl font-extrabold text-emerald-800 font-mono-numbers mt-2">
              {readyCount}
            </div>
            <div className="text-[11px] text-[#4A5878] mt-0.5">High confidence suggestions</div>
          </div>
          {readyCount > 0 && (
            <button
              type="button"
              onClick={handleConfirmAllReady}
              className="mt-3 w-full py-1.5 px-3 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold rounded-lg flex items-center justify-center gap-1.5 shadow-2xs transition-transform active:scale-[0.98]"
            >
              <Check className="w-3.5 h-3.5 stroke-[2.5]" />
              <span>Confirm all Ready ({readyCount})</span>
            </button>
          )}
        </div>

        {/* CHECK GATE */}
        <div className="bg-white border-2 border-amber-500/30 rounded-xl p-4 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-xs font-bold text-amber-800">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                Check (70–89%)
              </span>
              <span className="text-[10px] bg-amber-100 text-amber-900 px-2 py-0.5 rounded-full font-mono">
                Gate: Check
              </span>
            </div>
            <div className="text-2xl font-extrabold text-amber-800 font-mono-numbers mt-2">
              {checkCount}
            </div>
            <div className="text-[11px] text-[#4A5878] mt-0.5">Review in small groups</div>
          </div>
          <div className="text-[10px] text-amber-700 font-medium bg-amber-50 p-1.5 rounded-lg border border-amber-200 mt-2">
            Requires preparer review before sign-off
          </div>
        </div>

        {/* EXCEPTION GATE */}
        <div className="bg-white border-2 border-red-500/30 rounded-xl p-4 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-xs font-bold text-red-800">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
                Exception (&lt;70%)
              </span>
              <span className="text-[10px] bg-red-100 text-red-900 px-2 py-0.5 rounded-full font-mono">
                Gate: Exception
              </span>
            </div>
            <div className="text-2xl font-extrabold text-red-800 font-mono-numbers mt-2">
              {exceptionCount}
            </div>
            <div className="text-[11px] text-[#4A5878] mt-0.5">Map one at a time by hand</div>
          </div>
          <div className="text-[10px] text-red-700 font-medium bg-red-50 p-1.5 rounded-lg border border-red-200 mt-2">
            Cannot be bulk confirmed
          </div>
        </div>

        {/* CONFIRMED */}
        <div className="bg-white border border-[#E3E7EF] rounded-xl p-4 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-xs font-bold text-[#122654]">
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-[#0B6B52]" />
                Confirmed
              </span>
              <span className="text-[10px] bg-gray-100 text-gray-700 px-2 py-0.5 rounded-full font-mono">
                {totalImported > 0 ? Math.round((confirmedCount / totalImported) * 100) : 0}%
              </span>
            </div>
            <div className="text-2xl font-extrabold text-[#122654] font-mono-numbers mt-2">
              {confirmedCount} / {totalImported}
            </div>
            <div className="text-[11px] text-[#4A5878] mt-0.5">Agreed by accountant</div>
          </div>
          <div className="text-[10px] text-[#4A5878] mt-2 font-mono">
            {confirmedCount === totalImported ? 'All accounts verified' : `${totalImported - confirmedCount} unconfirmed`}
          </div>
        </div>

        {/* UNMAPPED BALANCE (GROUND RULE 2) */}
        <div
          className={`rounded-xl p-4 border-2 shadow-xs flex flex-col justify-between ${
            isFullyMapped
              ? 'border-emerald-500/50 bg-[#E6F4EF]/60'
              : 'border-red-500/60 bg-[#FDECEA]/60'
          }`}
        >
          <div>
            <div
              className={`text-xs font-bold uppercase tracking-wider ${
                isFullyMapped ? 'text-[#0B6B52]' : 'text-red-700'
              }`}
            >
              Unmapped Balance
            </div>
            <div
              className={`text-xl font-extrabold font-mono-numbers mt-1.5 ${
                isFullyMapped ? 'text-[#0B6B52]' : 'text-red-700'
              }`}
            >
              {formatPence(unmappedBalancePence)}
            </div>
            <div className="text-[10px] mt-1 font-semibold text-[#122654]">
              {isFullyMapped ? '✓ Working papers unlocked' : 'Must be £0.00 to balance'}
            </div>
          </div>
          <div className="text-[9px] text-[#4A5878] mt-2">
            Auto-accept: <strong>OFF</strong>
          </div>
        </div>
      </div>

      {/* Fully Mapped Success Card (DAT-04 UI step 5) */}
      {isFullyMapped && (
        <div className="p-4 bg-emerald-50 border-2 border-emerald-500 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-3 text-xs text-emerald-900">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <div>
              <strong className="block text-sm font-bold text-emerald-900">
                All accounts mapped!
              </strong>
              <span>
                Trial balance is in complete balance with £0.00 unmapped variance. All 17 control account schedules are ready.
              </span>
            </div>
          </div>
          <Link
            href={`/engagements/${engagementId}/workpapers`}
            className="px-5 py-2.5 bg-[#122654] hover:bg-[#0B1A3B] text-white text-xs font-bold rounded-xl flex items-center justify-center gap-2 shadow-xs transition-transform active:scale-[0.98] shrink-0"
          >
            <span>Go to working paper</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      )}

      {/* Main Table Card */}
      <div className="bg-white border border-[#E3E7EF] rounded-xl shadow-xs overflow-hidden">
        {/* Table Toolbar */}
        <div className="p-4 border-b border-[#E3E7EF] flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          {/* Gate Filters (DAT-04 UI step 1 & 2) */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 lg:pb-0">
            {[
              { id: 'all', label: 'All', count: totalImported },
              { id: 'ready', label: 'Ready', count: readyCount, color: 'text-emerald-700' },
              { id: 'check', label: 'Check', count: checkCount, color: 'text-amber-700' },
              { id: 'exception', label: 'Exception', count: exceptionCount, color: 'text-red-700' },
              { id: 'confirmed', label: 'Confirmed', count: confirmedCount },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as any)}
                className={`min-h-[38px] px-3.5 text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-all cursor-pointer shrink-0 ${
                  activeTab === tab.id
                    ? 'bg-[#122654] text-white shadow-xs'
                    : 'text-[#4A5878] hover:bg-[#F5F8FD] hover:text-[#122654]'
                }`}
              >
                <span>{tab.label}</span>
                <span
                  className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full ${
                    activeTab === tab.id ? 'bg-white/20 text-white' : 'bg-[#F5F8FD] text-[#4A5878]'
                  }`}
                >
                  {tab.count}
                </span>
              </button>
            ))}
          </div>

          {/* Search & Actions */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-[#4A5878] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input aria-label="Search code, name, schedule"
                id="mapping-search"
                type="text"
                placeholder="Search code, name, schedule..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="min-h-[38px] pl-8 pr-3 text-xs bg-[#F5F8FD] border border-[#D3DCEE] rounded-xl text-[#122654] outline-none focus:border-[#FF7A66] w-52"
              />
            </div>

            <button
              type="button"
              onClick={mapWithAi}
              disabled={aiBusy}
              title="The AI reads every unconfirmed line and suggests an account. Nothing is confirmed until you confirm it."
              className="min-h-[38px] px-3 text-xs font-bold text-[#B8432F] bg-[#FFF8F6] hover:bg-[#FFF1EE] border border-[#FF7A66]/40 rounded-xl flex items-center gap-1.5 disabled:opacity-60"
            >
              <Sparkles className={`w-3.5 h-3.5 ${aiBusy ? 'animate-pulse' : ''}`} />
              {aiBusy ? 'AI is reading the lines…' : 'Map with AI'}
            </button>

            <select
              aria-label="Order within each type"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'amount' | 'code')}
              className="min-h-[38px] px-2 text-xs font-semibold text-[#122654] bg-white border border-[#D3DCEE] rounded-xl"
            >
              <option value="amount">Largest balance first</option>
              <option value="code">Code order</option>
            </select>

            {/* Optional columns */}
            {([
              ['statutory line', showStatutory, setShowStatutory],
              ['AI reason', showReason, setShowReason],
            ] as const).map(([name, shown, setShown]) => (
              <button
                key={name}
                type="button"
                aria-pressed={shown}
                onClick={() => setShown(!shown)}
                className="min-h-[38px] px-3 text-xs font-semibold text-[#122654] bg-white hover:bg-[#EAF5FC] border border-[#D3DCEE] rounded-xl"
              >
                {shown ? 'Hide' : 'Show'} {name}
              </button>
            ))}

            {/* Batch Remap Toolbar (DAT-04 step 4) */}
            {selectedIds.length > 0 && (
              <div className="flex items-center gap-2 bg-[#EAF5FC] border border-[#B3D7F5] px-3 py-1.5 rounded-xl">
                <span className="text-xs font-bold text-[#122654]">
                  Map selected ({selectedIds.length}) to:
                </span>
                <select
                  aria-label="Map selected accounts"
                  value={batchTargetCode}
                  onChange={(e) => setBatchTargetCode(e.target.value)}
                  className="text-xs font-semibold py-1 px-2 border border-[#D3DCEE] rounded-lg bg-white text-[#122654] max-w-[200px]"
                >
                  <option value="">Select target COA…</option>
                  <ChartOptions engagementId={engagementId} />
                </select>
                <button
                  type="button"
                  disabled={!batchTargetCode}
                  onClick={handleApplyBatchRemap}
                  className="px-2.5 py-1 bg-[#122654] hover:bg-[#0B1A3B] text-white text-xs font-bold rounded-lg disabled:opacity-40"
                >
                  Apply
                </button>
              </div>
            )}

            {/* Confirm Selected Button */}
            <button
              type="button"
              disabled={selectedIds.length === 0}
              onClick={handleConfirmSelected}
              className="min-h-[38px] px-4 bg-[#FF7A66] hover:bg-[#ff9485] text-[#0B1A3B] text-xs font-bold rounded-xl flex items-center gap-1.5 disabled:opacity-40 cursor-pointer shadow-xs transition-transform active:scale-[0.98]"
            >
              <Check className="w-4 h-4 stroke-[2.5]" />
              <span>Confirm selected ({selectedIds.length})</span>
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-[#122654]">
            <thead className="bg-[#F5F8FD] text-[#4A5878] uppercase text-[10px] font-bold tracking-wider border-b border-[#E3E7EF]">
              <tr>
                <th scope="col" className="p-3 pl-4 w-10">
                  <input
                    type="checkbox"
                    checked={selectedIds.length > 0 && selectedIds.length === filteredMappings.length}
                    onChange={handleSelectAllVisible}
                    className="w-4 h-4 rounded border-[#D3DCEE] text-[#122654] focus:ring-[#FF7A66]"
                  />
                </th>
                <th scope="col" className="p-3">Codes</th>
                <th scope="col" className="p-3">Ledger Name</th>
                <th scope="col" className="p-3 text-right">Balance</th>
                {showStatutory && <th scope="col" className="p-3">Statutory Line &amp; Schedule</th>}
                <th scope="col" className="p-3">Confidence &amp; Gate</th>
                {showReason && <th scope="col" className="p-3">AI Reason &amp; Evidence</th>}
                <th scope="col" className="p-3 pr-4">Blynt Account (Mapping)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E3E7EF]">
              {groups.map((g) => (
                <Fragment key={g.type}>
                  <tr className="bg-[#F5F8FD]">
                    <th scope="rowgroup" colSpan={columns} className="px-4 py-2 text-left text-[11px] font-bold text-[#122654]">
                      {g.type}
                      <span className="ml-2 font-normal text-[#4A5878]">
                        {g.rows.length} account{g.rows.length === 1 ? '' : 's'} · {formatPence(g.total, { accountingFormat: true })}
                      </span>
                    </th>
                  </tr>
              {g.rows.map((row) => {
                const isSelected = selectedIds.includes(row.id);
                const stat = getStatutoryDetails(row.blynt_code, row.source_name, row.source_type);
                const isSignMismatch =
                  (stat.is_credit_area && asPence(row.balance_p) > 0n) ||
                  (!stat.is_credit_area && asPence(row.balance_p) < 0n);

                const gateName =
                  row.status === 'confirmed'
                    ? 'confirmed'
                    : row.confidence >= 90
                    ? 'ready'
                    : row.confidence >= 70
                    ? 'check'
                    : 'exception';
                // A new account to offer: the AI's, or for a weak match one named as the client names it, starting from the guess
                const proposal =
                  row.status === 'confirmed'
                    ? null
                    : row.ai_new_account ?? (gateName === 'exception' ? { name: row.source_name, parent_code: row.blynt_code ?? '' } : null);

                return (
                  <tr
                    key={row.id}
                    className={`hover:bg-[#F5F8FD] transition-colors cursor-pointer ${
                      activeDetailId === row.id ? 'bg-[#EAF5FC]/50' : ''
                    } ${isSignMismatch ? 'bg-amber-50/20' : ''}`}
                    onClick={() => setActiveDetailId(row.id)}
                    tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && setActiveDetailId(row.id)}
                  >
                    <td className="p-3 pl-4" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleToggleSelect(row.id)}
                        className="w-4 h-4 rounded border-[#D3DCEE] text-[#122654] focus:ring-[#FF7A66]"
                      />
                    </td>

                    {/* The company's own ledger code, and the Blynt chart code it maps to */}
                    <td className="p-3 whitespace-nowrap">
                      <div className="grid grid-cols-[52px_auto] items-center gap-x-1.5 gap-y-1 text-[11px]">
                        <span className="text-[9px] font-bold uppercase tracking-wide text-[#7E8DA6]">Company</span>
                        <span className="font-mono font-bold text-[#122654] bg-[#F5F8FD] px-2 py-0.5 rounded">{row.source_code}</span>
                        <span className="text-[9px] font-bold uppercase tracking-wide text-[#7E8DA6]">Blynt</span>
                        {row.blynt_code ? (
                          <span
                            title={`${row.blynt_code} ${db.blynt_accounts.find((a) => a.code === row.blynt_code)?.name ?? ''}`}
                            className={`font-mono font-bold px-2 py-0.5 rounded ${row.status === 'confirmed' ? 'bg-[#E6F4EF] text-[#0B6B52]' : 'bg-[#EAF5FC] text-[#1D4E89]'}`}
                          >
                            {row.blynt_code}
                          </span>
                        ) : (
                          <span className="text-[#7E8DA6]">–</span>
                        )}
                      </div>
                    </td>

                    {/* Name */}
                    <td className="p-3">
                      <div className="font-bold text-[#122654]">{row.source_name}</div>
                      <div className="text-[10px] text-[#4A5878]">{row.source_type}</div>
                    </td>

                    {/* Balance */}
                    <td className="p-3 text-right font-mono-numbers font-semibold">
                      <div className="flex items-center justify-end gap-1.5">
                        {isSignMismatch && (
                          <span
                            title="Sign mismatch: Balance sign contradicts statutory mapping classification"
                            className="text-amber-600 bg-amber-100 p-0.5 rounded-full"
                          >
                            <AlertTriangle className="w-3.5 h-3.5" />
                          </span>
                        )}
                        <span>{formatPence(row.balance_p, { accountingFormat: true })}</span>
                      </div>
                    </td>

                    {/* Statutory Line & Schedule */}
                    {showStatutory && (
                      <td className="p-3">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono font-bold text-[10px] bg-[#EAF5FC] text-[#1D4E89] px-1.5 py-0.5 rounded">
                            {row.schedule_ref || stat.schedule_ref}
                          </span>
                          <span className="text-[11px] font-medium text-[#122654] truncate max-w-[200px]" title={row.statutory_line || stat.statutory_line}>
                            {row.statutory_line || stat.statutory_line}
                          </span>
                        </div>
                        <div className="text-[10px] text-[#7E8DA6] mt-0.5">
                          {row.cash_flow_category || stat.cash_flow_category}
                        </div>
                      </td>
                    )}

                    {/* Confidence & Gate Badge */}
                    <td className="p-3">
                      {row.status === 'confirmed' ? (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 flex items-center gap-1 w-max">
                          <Check className="w-3 h-3 stroke-[2.5]" />
                          <span>Confirmed</span>
                        </span>
                      ) : gateName === 'ready' ? (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-300 flex items-center gap-1 w-max">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                          <span>Ready {row.confidence}%</span>
                        </span>
                      ) : gateName === 'check' ? (
                        <span title={why(row).reasons.join(' ')} className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-300 flex items-center gap-1 w-max">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                          <span>Check {row.confidence}%</span>
                        </span>
                      ) : (
                        <span title={[why(row).blocker, ...why(row).reasons].filter(Boolean).join(' ')} className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200 flex items-center gap-1 w-max">
                          <AlertTriangle className="w-3 h-3" />
                          <span>Exception {row.confidence}%</span>
                        </span>
                      )}
                      {row.method === 'ai' && (
                        <span
                          title={row.ai_reason || 'Mapped by the AI'}
                          className="mt-1 inline-flex items-center gap-0.5 mr-1 px-1.5 py-0.5 text-[10px] font-bold text-[#B8432F] bg-[#FFF1EE] border border-[#FF7A66]/40 rounded-full"
                        >
                          <Sparkles className="w-3 h-3" /> AI
                        </span>
                      )}
                      {row.status !== 'confirmed' && row.blynt_code && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            confirmMappings([row.id]);
                          }}
                          aria-label={`Confirm ${row.source_code} ${row.source_name} as ${row.blynt_code}`}
                          className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold text-white bg-[#122654] hover:bg-[#0B1A3B] rounded-full"
                        >
                          <Check className="w-3 h-3 stroke-[2.5]" /> Confirm
                        </button>
                      )}
                    </td>

                    {/* AI Reason & Evidence (hoverable) */}
                    {showReason && (
                      <td className="p-3">
                        <div
                          className="text-[11px] text-[#4A5878] line-clamp-1 group relative cursor-help"
                          title={`Evidence chain: ${row.evidence_used || 'Client rules > Practice rules > Prior-year mapping > Pattern'}`}
                        >
                          <span className="font-medium text-[#122654]">
                            {row.ai_reason || `Matched nominal name pattern "${row.source_name.split(' ')[0]}"`}
                          </span>
                          <div className="text-[10px] text-[#7E8DA6]">
                            {row.evidence_used || 'Rule > Name pattern > Code range'}
                          </div>
                        </div>
                      </td>
                    )}

                    {/* Blynt Account Dropdown */}
                    <td className="p-3 pr-4" onClick={(e) => e.stopPropagation()}>
                      <AccountPicker
                        key={row.blynt_code || ''}
                        value={row.blynt_code || ''}
                        label={`Select mapping for ${row.source_name}`}
                        firmId={firmId}
                        clientId={engagementClientId ?? undefined}
                        suggestName={row.source_name}
                        onPick={(code) => handleInitiateChangeMapping(row.id, code)}
                      />
                      {/* No chart account fits (the AI says so, or the match is weak): offer a new account, created only when someone approves it */}
                      {proposal && (
                        creatingFor === row.id ? (
                          <div className="mt-2 max-w-sm">
                            <NewAccountForm
                              firmId={firmId}
                              clientId={engagementClientId ?? undefined}
                              initialName={proposal.name}
                              initialBase={proposal.parent_code || undefined}
                              onCancel={() => setCreatingFor(null)}
                              onUseExisting={(code) => {
                                setCreatingFor(null);
                                handleInitiateChangeMapping(row.id, code);
                              }}
                              onCreated={(acc) => {
                                setCreatingFor(null);
                                const m = db.account_mappings.find((x) => x.id === row.id);
                                if (m) m.ai_new_account = null;
                                handleInitiateChangeMapping(row.id, acc.code);
                              }}
                            />
                          </div>
                        ) : (
                          <div className="mt-1 max-w-[260px] text-[10px] text-[#4A5878]">
                            {row.ai_new_account ? (
                              <>
                                <Sparkles className="inline w-3 h-3 mr-0.5 text-[#B8432F]" />
                                AI: no chart account fits.{' '}
                              </>
                            ) : (
                              'Weak match. Not in the chart? '
                            )}
                            <button type="button" onClick={() => setCreatingFor(row.id)} className="font-bold text-[#B8432F] hover:underline">
                              Create &ldquo;{proposal.name}&rdquo;
                            </button>
                            {proposal.parent_code ? ` (works like ${proposal.parent_code})` : ''}
                          </div>
                        )
                      )}
                    </td>
                  </tr>
                );
              })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        {/* Room for the action bar, so it never covers the last row */}
        {(selectedIds.length > 0 || confirmedCount < totalImported) && <div className="h-20" aria-hidden="true" />}
      </div>

      {/* The confirm actions follow the page down, so confirming never means scrolling back up */}
      {selectedIds.length === 0 && confirmedCount < totalImported && !ruleModalOpen && (
        <div role="region" aria-label="Confirm lines" className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 w-[calc(100%-32px)] max-w-3xl">
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 bg-[#122654] text-white rounded-2xl shadow-lg">
            <span className="text-xs mr-auto">
              <span className="font-bold">{totalImported - confirmedCount} to confirm</span>
              <span className="text-white/70"> · tick lines to confirm or remap several, or use Confirm on a row</span>
            </span>
            <button
              type="button"
              disabled={readyCount === 0}
              onClick={handleConfirmAllReady}
              className="min-h-[36px] px-4 bg-[#FF7A66] hover:bg-[#ff9485] text-[#0B1A3B] text-xs font-bold rounded-lg flex items-center gap-1.5 disabled:opacity-50"
            >
              <Check className="w-4 h-4 stroke-[2.5]" /> Confirm all Ready ({readyCount})
            </button>
          </div>
        </div>
      )}
      {selectedIds.length > 0 && !ruleModalOpen && (
        <div role="region" aria-label="Selected lines" className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 w-[calc(100%-32px)] max-w-3xl">
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 bg-[#122654] text-white rounded-2xl shadow-lg">
            <span className="text-xs font-bold mr-auto">
              {selectedIds.length} line{selectedIds.length === 1 ? '' : 's'} selected
            </span>
            <select
              aria-label="Map the selected lines to"
              value={batchTargetCode}
              onChange={(e) => setBatchTargetCode(e.target.value)}
              className="min-h-[36px] max-w-[200px] px-2 text-xs font-semibold text-[#122654] bg-white rounded-lg"
            >
              <option value="">Map to…</option>
              <ChartOptions engagementId={engagementId} />
            </select>
            {batchTargetCode && (
              <button type="button" onClick={handleApplyBatchRemap} className="min-h-[36px] px-3 text-xs font-bold bg-white/15 hover:bg-white/25 rounded-lg">
                Apply
              </button>
            )}
            <button
              type="button"
              onClick={handleConfirmSelected}
              className="min-h-[36px] px-4 bg-[#FF7A66] hover:bg-[#ff9485] text-[#0B1A3B] text-xs font-bold rounded-lg flex items-center gap-1.5"
            >
              <Check className="w-4 h-4 stroke-[2.5]" /> Confirm selected ({selectedIds.length})
            </button>
            <button type="button" onClick={() => setSelectedIds([])} className="min-h-[36px] px-2 text-xs font-semibold text-white/80 hover:text-white">
              Clear
            </button>
          </div>
        </div>
      )}

      {/* RULE CREATION MODAL UPON CORRECTION (DAT-09, DAT-05) */}
      {ruleModalOpen && pendingCorrection && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-[#0B1A3B]/50 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in"
        >
          <div className="bg-white border border-[#E3E7EF] rounded-xl shadow-2xl max-w-lg w-full p-6 animate-in zoom-in-95 space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-[#E3E7EF]">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-[#EAF5FC] text-[#1D4E89] flex items-center justify-center">
                  <Sparkles className="w-5 h-5 text-[#FF7A66]" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-[#122654]">Remember this mapping</h3>
                  <p className="text-[11px] text-[#4A5878]">So it is mapped this way automatically next time</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setRuleModalOpen(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3 bg-[#F5F8FD] rounded-xl text-xs space-y-1.5 border border-[#E3E7EF]">
              <div className="flex items-center justify-between">
                <span className="text-[#4A5878]">Nominal account:</span>
                <span className="font-mono font-bold text-[#122654]">
                  {pendingCorrection.sourceCode} {pendingCorrection.sourceName}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#4A5878]">Remapped to:</span>
                <span className="font-mono font-bold text-[#0B6B52]">
                  {pendingCorrection.targetCode} ({db.blynt_accounts.find((b) => b.code === pendingCorrection.targetCode)?.name})
                </span>
              </div>
            </div>

            {similar.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#122654]">Also map these to {pendingCorrection.targetCode}:</span>
                  <button
                    type="button"
                    onClick={() => setAlsoApply(alsoApply.length === similar.length ? [] : similar.map((s) => s.line.id))}
                    className="text-[11px] font-semibold text-[#1D4E89] hover:underline"
                  >
                    {alsoApply.length === similar.length ? 'Untick all' : 'Tick all'}
                  </button>
                </div>
                <div className="max-h-44 overflow-y-auto rounded-xl border border-[#E3E7EF] divide-y divide-[#E3E7EF]">
                  {similar.map(({ line }) => (
                    <label key={line.id} className="flex items-center gap-2.5 px-3 py-2 text-xs cursor-pointer hover:bg-[#F5F8FD]">
                      <input
                        type="checkbox"
                        checked={alsoApply.includes(line.id)}
                        onChange={() => setAlsoApply((ids) => (ids.includes(line.id) ? ids.filter((x) => x !== line.id) : [...ids, line.id]))}
                        className="w-4 h-4 rounded border-[#D3DCEE]"
                      />
                      <span className="font-mono text-[11px] text-[#4A5878] shrink-0">{line.source_code}</span>
                      <span className="flex-1 min-w-0 truncate font-semibold text-[#122654]">{line.source_name}</span>
                      <span className="shrink-0 text-[10px] text-[#4A5878]">
                        {line.blynt_code ? `now ${line.blynt_code}${line.status === 'confirmed' ? ', confirmed' : ''}` : 'not mapped'}
                      </span>
                    </label>
                  ))}
                </div>
                <p className="text-[10px] text-[#4A5878]">Ticked lines are mapped to {pendingCorrection.targetCode} and confirmed, and the rule covers them in future years too.</p>
              </div>
            )}

            {/* Scope Selection (DAT-09 UI step 1): the highlight follows the choice */}
            <fieldset className="space-y-2">
              <legend className="block text-xs font-bold text-[#122654] mb-2">Remember this for:</legend>
              <div className="space-y-2 text-xs">
                {(
                  [
                    ['client', `${clientName} only`, `Next year's import for ${clientName} maps ${patternsHint} the same way.`],
                    [
                      'practice',
                      'Every client in the practice',
                      canApprove
                        ? 'Takes effect straight away for every client with an account named like this.'
                        : 'A manager approves it first (Settings > Rules). Until then it applies only to the lines here.',
                    ],
                  ] as const
                ).map(([scope, title, detail]) => (
                  <label
                    key={scope}
                    className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer ${ruleScope === scope ? 'border-emerald-400 bg-emerald-50/50' : 'border-gray-200 hover:bg-gray-50'}`}
                  >
                    <input type="radio" name="ruleScope" checked={ruleScope === scope} onChange={() => setRuleScope(scope)} className="mt-0.5" />
                    <div>
                      <div className={`font-bold ${ruleScope === scope ? 'text-[#0B6B52]' : 'text-[#122654]'}`}>{title}</div>
                      <div className="text-[11px] text-[#4A5878]">{detail}</div>
                    </div>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setRuleModalOpen(false)}
                className="px-4 py-2 text-xs font-semibold text-[#4A5878] hover:text-[#122654]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveCorrectionWithRule}
                className="px-5 py-2.5 bg-[#122654] hover:bg-[#0B1A3B] text-white text-xs font-bold rounded-xl shadow-xs transition-transform active:scale-[0.98]"
              >
                {alsoApply.length ? `Map ${alsoApply.length + 1} lines and remember` : 'Map and remember'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Account Detail Slide-over Panel */}
      {detailMapping && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-[#0B1A3B]/40 backdrop-blur-xs flex items-center justify-end animate-in fade-in"
        >
          <div className="w-full max-w-md h-full bg-white shadow-2xl flex flex-col border-l border-[#E3E7EF] animate-in slide-in-from-right">
            <div className="p-4 border-b border-[#E3E7EF] flex items-center justify-between bg-[#122654] text-white">
              <div>
                <span className="text-[10px] uppercase font-bold text-[#FF7A66] tracking-wider">
                  Mapping Facts &amp; Evidence
                </span>
                <h3 className="text-sm font-bold mt-0.5">
                  {detailMapping.source_code} • {detailMapping.source_name}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setActiveDetailId(null)}
                className="p-1 text-white/70 hover:text-white rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 p-5 overflow-y-auto flex flex-col gap-5 text-xs text-[#122654]">
              {/* Account Facts */}
              <div className="p-3.5 bg-[#F5F8FD] border border-[#E3E7EF] rounded-xl flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-[#4A5878]">Source balance:</span>
                  <span className="font-mono font-bold text-sm">
                    {formatPence(detailMapping.balance_p)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[#4A5878]">Source category:</span>
                  <span className="font-semibold">{detailMapping.source_type}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[#4A5878]">Evidence hierarchy:</span>
                  <span className="text-[11px] font-mono font-medium text-[#1D4E89]">
                    {detailMapping.evidence_used || 'Client rule > Prior year > Name match'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[#4A5878]">Confidence:</span>
                  <span className="font-bold text-emerald-700">{detailMapping.confidence}%</span>
                </div>
              </div>

              {detailMapping.status !== 'confirmed' && (() => {
                const w = why(detailMapping);
                return (
                  <div role="status" className={`p-3.5 rounded-xl border flex flex-col gap-1.5 ${w.blocker ? 'bg-red-50 border-red-200 text-red-800' : 'bg-amber-50 border-amber-200 text-amber-900'}`}>
                    <span className="font-bold">{w.blocker ? 'Why this can’t be confirmed' : 'Why this isn’t confirmed yet'}</span>
                    {w.blocker && <p>{w.blocker}</p>}
                    {w.reasons.map((r) => (
                      <p key={r}>{r}</p>
                    ))}
                    {!w.blocker && !w.reasons.length && <p>Nothing to check: confirm it when you are happy.</p>}
                  </div>
                );
              })()}

              {/* AI Alternatives */}
              {(detailMapping.ai_alternatives ?? []).length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 text-xs font-bold text-[#A23A27] mb-2">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>✦ AI Suggested Alternatives</span>
                </div>
                <div className="space-y-2">
                  {(detailMapping.ai_alternatives ?? []).filter((alt) => db.blynt_accounts.some((a) => a.code === alt.blynt_code)).map((alt) => (
                    <button
                      key={alt.blynt_code}
                      type="button"
                      onClick={() => setPickCode(alt.blynt_code)}
                      className={`w-full text-left p-3 rounded-xl border transition-all ${
                        pickCode === alt.blynt_code
                          ? 'border-[#122654] bg-[#F5F8FD]'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-bold text-[#122654]">{alt.blynt_code} {alt.name}</span>
                        <span className="text-[10px] font-mono text-[#A23A27] bg-[#FFF1EE] px-1.5 py-0.5 rounded">
                          {alt.confidence}%
                        </span>
                      </div>
                      <p className="text-[11px] text-[#4A5878] mt-1">{alt.reason}</p>
                    </button>
                  ))}
                </div>
              </div>
              )}
            </div>

            <div className="p-4 border-t border-[#E3E7EF] flex items-center justify-between">
              <button
                type="button"
                onClick={() => setActiveDetailId(null)}
                className="px-4 py-2 border border-[#D3DCEE] rounded-xl text-xs font-semibold text-[#4A5878]"
              >
                Close
              </button>
              {detailMapping.status !== 'confirmed' && detailMapping.blynt_code && (!pickCode || pickCode === detailMapping.blynt_code) && (
                <button
                  type="button"
                  onClick={() => {
                    confirmMappings([detailMapping.id]);
                    setActiveDetailId(null);
                  }}
                  className="ml-auto mr-2 px-5 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold rounded-xl"
                >
                  Confirm {detailMapping.blynt_code}
                </button>
              )}
              <button
                type="button"
                disabled={!pickCode || pickCode === detailMapping.blynt_code}
                onClick={() => {
                  handleInitiateChangeMapping(detailMapping.id, pickCode);
                  setActiveDetailId(null);
                }}
                className="px-5 py-2.5 bg-[#122654] hover:bg-[#0B1A3B] text-white text-xs font-bold rounded-xl shadow-xs disabled:opacity-40"
              >
                Save &amp; Create Rule…
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Correction Toast (DAT-05 UI step 1) */}
      {correctionToast && (
        <div className="fixed bottom-6 right-6 z-50 bg-[#122654] text-white px-5 py-3.5 rounded-xl shadow-2xl flex items-center gap-3 text-xs font-semibold animate-in fade-in slide-in-from-bottom-3 border border-white/10">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{correctionToast.message}</span>
          {correctionToast.undoAction && (
            <button
              type="button"
              onClick={correctionToast.undoAction}
              className="ml-2 text-[#FF7A66] hover:underline font-bold"
            >
              Undo
            </button>
          )}
        </div>
      )}
    </div>
  );
}
