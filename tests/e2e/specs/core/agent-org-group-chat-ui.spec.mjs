/* global describe, before, beforeEach, afterEach, it, process */
import {
  API_AGENT_TYPE,
  BUILTIN_SDE_AGENT_ID,
  DEFAULT_AGENT_ORG_ID,
  DEFAULT_AGENT_ORG_MEMBER_IDS,
  RUN_ID,
  RENDER_TIMEOUT_MS,
  REPLY_TIMEOUT_MS,
  SHARED_CLI_AGENT_ID,
  AGENT_ORG_COORDINATOR_MEMBER_ID,
  AGENT_ORG_TASK_STATUS,
  assertCrashRecoveryBannerAbsent,
  assertLongTaskRenderedCollapsed,
  assertNoCurrentPlanBuildSurface,
  assertNoFalseFinality,
  assertNoMemberIntervention,
  assertRenderedGroupChatNoQuoteOrUnreadPreview,
  assertRenderedGroupChatToggleIsIdempotent,
  assertRenderedInboxPinBarAbsent,
  clickGroupChatResumeButton,
  clickRenderedMemberSwitcher,
  clickReturnToWorkAndWaitCleared,
  configureCreatorForAgentOrg,
  configureCreatorForDefaultAgentOrg,
  createLongTaskPrecondition,
  createRenderedStrictTwoMemberAgentOrg,
  execJS,
  executeCreatePlanAsMember,
  getApiAccount,
  invokeE2E,
  js,
  openAgentOrgOverviewPanel,
  openRenderedGroupChatView,
  openRenderedSidebarSession,
  parseInboxPayload,
  refreshRenderedAgentOrgOverview,
  removeAgentOrgsByName,
  selectMemberOverrideModel,
  selectPreferredModel,
  selectRenderedAgentOrg,
  selectRenderedDefaultAgentOrg,
  selectRenderedExecMode,
  sendCoordinatorOrgMessage,
  sendFromRenderedCreator,
  sendRenderedGroupChatMentionPrompt,
  sendRenderedChatPrompt,
  unwrap,
  waitForActiveSessionExecMode,
  waitForAgentOrgByName,
  waitForAgentOrgRunView,
  waitForAgentOrgRunViewByOrg,
  waitForCoordinatorRuntimeStatus,
  waitForGroupChatPausedBanner,
  waitForGroupChatPendingTarget,
  waitForInboxRow,
  waitForInboxRowRead,
  waitForIntervention,
  waitForMemberPostMessageActivity,
  waitForPlanApprovalRequest,
  waitForPromptDump,
  waitForRenderedAssistantReply,
  waitForRenderedGroupChatActive,
  waitForRenderedGroupChatMessage,
  waitForRenderedGroupChatUserTurn,
  waitForRenderedInterventionPin,
  waitForRenderedReleasedTask,
  waitForSessionAggregateRow,
  waitForSessionOrgRuntimeSnapshot,
  waitForApp,
  assertE2ERepoFixture,
} from "../../support/core/agentOrgUiDriver.mjs";


async function pauseDefaultAgentOrgRuns(label) {
  const listResult = unwrap(
    await invokeE2E("agentOrgRunList", 50),
    `agentOrgRunList(${label})`
  );
  const activeRuns = (listResult.runs ?? []).filter(
    (run) =>
      run?.orgId === DEFAULT_AGENT_ORG_ID &&
      run?.rootSessionId &&
      run?.status !== "completed" &&
      run?.status !== "failed" &&
      run?.status !== "cancelled" &&
      run?.status !== "paused"
  );
  for (const run of activeRuns) {
    unwrap(
      await invokeE2E("agentOrgPauseRun", run.rootSessionId),
      `agentOrgPauseRun(${label}:${run.rootSessionId})`
    );
  }
}

describe("Agent Org group chat and plan rendered UI", () => {
  before(async () => {
    assertE2ERepoFixture();
    await waitForApp();
  });

  beforeEach(async () => {
    await pauseDefaultAgentOrgRuns("beforeEach");
    await invokeE2E("resetToNewSession");
  });

  afterEach(async () => {
    await pauseDefaultAgentOrgRuns("afterEach");
    await invokeE2E("resetToNewSession");
  });

  it("launches default Agent Org in Plan mode through rendered UI", async () => {
    const account = await getApiAccount();
    const model = selectPreferredModel(account);
    await configureCreatorForDefaultAgentOrg({ account, model });
    await selectRenderedExecMode("plan");
    await selectRenderedDefaultAgentOrg();

    const launchPrompt = `E2E true positive default Agent Org plan mode ${RUN_ID}. Produce a concise plan only.`;
    const sessionId = await sendFromRenderedCreator(launchPrompt);
    if (!sessionId) {
      throw new Error(
        "Default Agent Org plan launch did not create a session id"
      );
    }
    await waitForRenderedAssistantReply("default Agent Org plan launch");
    await waitForActiveSessionExecMode(
      sessionId,
      "plan",
      "default Agent Org plan launch"
    );

    const dump = await waitForPromptDump(sessionId);
    if (dump.agentDefinitionId !== BUILTIN_SDE_AGENT_ID) {
      throw new Error(
        `default Agent Org plan coordinator agent mismatch: ${JSON.stringify(dump)}`
      );
    }
    const promptText = String(dump.prompt ?? "");
    if (!promptText.includes("Agent Org")) {
      throw new Error(
        "default Agent Org plan prompt did not include Agent Org context"
      );
    }
    if (
      !promptText.includes("### Planning workflow") ||
      !promptText.includes('kind = "exec_mode_set_request"') ||
      !promptText.includes('mode = "plan"') ||
      !promptText.includes('kind = "plan_approval_response"')
    ) {
      throw new Error(
        `default Agent Org prompt did not include coordinator Planner protocol: ${JSON.stringify({ prompt: promptText.slice(0, 4000) })}`
      );
    }

    await waitForAgentOrgRunView(
      sessionId,
      (view) => {
        const members = view?.members ?? [];
        const expectedMembers = Object.values(DEFAULT_AGENT_ORG_MEMBER_IDS);
        const allMembersMaterialized = expectedMembers.every((memberId) =>
          members.some(
            (member) =>
              member.memberId === memberId &&
              member.agentId === BUILTIN_SDE_AGENT_ID &&
              member.sessionRuntime?.sessionId
          )
        );
        return Boolean(
          view?.currentMemberId === AGENT_ORG_COORDINATOR_MEMBER_ID &&
          view?.context?.runId &&
          allMembersMaterialized
        );
      },
      "default Agent Org plan members materialized"
    );
  });

  it("allows switching to a member with inbox activity but no tasks", async () => {
    const account = await getApiAccount();
    const model = selectPreferredModel(account);
    await configureCreatorForDefaultAgentOrg({ account, model });
    await selectRenderedExecMode("plan");
    await selectRenderedDefaultAgentOrg();

    const launchPrompt = `E2E inbox-only member switch ${RUN_ID}. Produce a concise plan only.`;
    const sessionId = await sendFromRenderedCreator(launchPrompt);
    if (!sessionId) {
      throw new Error(
        "Inbox-only member switch launch did not create a session id"
      );
    }
    await waitForRenderedAssistantReply("inbox-only member switch launch");

    let plannerSessionId = null;
    await waitForAgentOrgRunView(
      sessionId,
      (view) => {
        const planner = (view?.members ?? []).find(
          (member) => member.memberId === DEFAULT_AGENT_ORG_MEMBER_IDS.PLANNER
        );
        plannerSessionId = planner?.sessionRuntime?.sessionId ?? null;
        return Boolean(
          view?.currentMemberId === AGENT_ORG_COORDINATOR_MEMBER_ID &&
          view?.context?.runId &&
          plannerSessionId &&
          planner.activeTaskCount === 0 &&
          planner.pendingTaskCount === 0 &&
          planner.inProgressTaskCount === 0 &&
          planner.completedTaskCount === 0
        );
      },
      "inbox-only planner materialized with no tasks"
    );
    if (!plannerSessionId) {
      throw new Error(
        "Inbox-only member switch did not materialize planner session"
      );
    }

    await sendCoordinatorOrgMessage(
      sessionId,
      {
        recipient_member_id: DEFAULT_AGENT_ORG_MEMBER_IDS.PLANNER,
        kind: "plain",
        summary: `E2E inbox-only member switch ${RUN_ID}`,
        text: `E2E inbox-only message ${RUN_ID}`,
      },
      "inbox-only planner message"
    );
    await waitForAgentOrgRunView(
      sessionId,
      (view) => {
        const planner = (view?.members ?? []).find(
          (member) => member.memberId === DEFAULT_AGENT_ORG_MEMBER_IDS.PLANNER
        );
        return Boolean(
          planner?.inboxActivityCount > 0 &&
          planner.activeTaskCount === 0 &&
          planner.pendingTaskCount === 0 &&
          planner.inProgressTaskCount === 0 &&
          planner.completedTaskCount === 0
        );
      },
      "planner has inbox activity but no tasks"
    );
    unwrap(
      await invokeE2E("openSession", sessionId),
      "openSession(coordinator before inbox-only switch)"
    );
    await waitForAgentOrgRunView(
      sessionId,
      (view) => view?.currentMemberId === AGENT_ORG_COORDINATOR_MEMBER_ID,
      "coordinator active before inbox-only member switch"
    );
    await refreshRenderedAgentOrgOverview("inbox-only member switch refresh");

    await clickRenderedMemberSwitcher(
      DEFAULT_AGENT_ORG_MEMBER_IDS.PLANNER,
      plannerSessionId
    );
    await waitForAgentOrgRunView(
      plannerSessionId,
      (view) => view?.currentMemberId === DEFAULT_AGENT_ORG_MEMBER_IDS.PLANNER,
      "planner switchable with inbox activity but no tasks"
    );
  });

  it("routes rendered group chat mentions as non-interrupting user inbox messages", async () => {
    const account = await getApiAccount();
    const model = selectPreferredModel(account);
    await configureCreatorForDefaultAgentOrg({ account, model });
    await selectRenderedExecMode("build");
    await selectRenderedDefaultAgentOrg();

    const launchPrompt = `E2E rendered Agent Org group chat routing ${RUN_ID}. Reply briefly.`;
    const sessionId = await sendFromRenderedCreator(launchPrompt);
    if (!sessionId) {
      throw new Error(
        "Agent Org group chat routing launch did not create a session id"
      );
    }
    let runId = null;
    let plannerSessionId = null;
    let plannerName = null;
    let coordinatorName = null;
    await waitForAgentOrgRunView(
      sessionId,
      (view) => {
        const planner = (view?.members ?? []).find(
          (member) => member.memberId === DEFAULT_AGENT_ORG_MEMBER_IDS.PLANNER
        );
        const coordinator = (view?.members ?? []).find(
          (member) => member.memberId === AGENT_ORG_COORDINATOR_MEMBER_ID
        );
        runId = view?.context?.runId ?? null;
        plannerSessionId = planner?.sessionRuntime?.sessionId ?? null;
        plannerName = planner?.name ?? null;
        coordinatorName = coordinator?.name ?? "Coordinator";
        return Boolean(runId && plannerSessionId && plannerName);
      },
      "group chat routing members materialized"
    );
    if (!plannerSessionId || !plannerName || !runId) {
      throw new Error("Group chat routing did not materialize planner runtime");
    }

    await createLongTaskPrecondition(
      sessionId,
      `group-chat-routing-${RUN_ID}`,
      `E2E group chat routing precondition ${RUN_ID}`,
      DEFAULT_AGENT_ORG_MEMBER_IDS.PLANNER
    );
    await waitForAgentOrgRunView(
      sessionId,
      (view) => {
        const planner = (view?.members ?? []).find(
          (member) => member.memberId === DEFAULT_AGENT_ORG_MEMBER_IDS.PLANNER
        );
        return Boolean(planner?.pendingTaskCount > 0);
      },
      "group chat routing has planner task for group view"
    );

    unwrap(
      await invokeE2E("openSession", sessionId),
      "openSession(coordinator before group chat routing)"
    );
    await refreshRenderedAgentOrgOverview(
      "group chat routing availability refresh"
    );
    await waitForRenderedGroupChatActive("default Agent Org entry");
    await openRenderedGroupChatView();
    await assertRenderedGroupChatToggleIsIdempotent(
      sessionId,
      "default Agent Org group chat re-select"
    );
    await assertRenderedGroupChatNoQuoteOrUnreadPreview(
      "initial group chat entry"
    );

    const plannerMessage = `E2E group chat mention to planner ${RUN_ID}. Reply in group chat and include token ${RUN_ID}.`;
    const plannerBaseline = unwrap(
      await invokeE2E("getSessionAggregateRow", plannerSessionId),
      "getSessionAggregateRow(planner before group chat mention drain)"
    ).session;
    const plannerBaselineUpdatedAt = plannerBaseline?.updatedAt ?? "";
    await sendRenderedGroupChatMentionPrompt(
      plannerName,
      plannerMessage,
      "planner mention"
    );
    const plannerInboxRow = await waitForInboxRow(
      sessionId,
      (row) => {
        const payload = parseInboxPayload(row, "planner group chat mention");
        return (
          row.senderAgentId === "_user" &&
          row.senderName === "User" &&
          row.recipientMemberId === DEFAULT_AGENT_ORG_MEMBER_IDS.PLANNER &&
          row.payloadKind === "plain" &&
          payload.text === plannerMessage
        );
      },
      "planner group chat inbox row persisted"
    );
    await waitForRenderedGroupChatUserTurn({
      text: `@${plannerName} ${plannerMessage}`,
      label: "planner mention rendered after inbox persist",
    });
    await assertRenderedGroupChatNoQuoteOrUnreadPreview(
      "planner mention rendered after inbox persist"
    );
    await waitForInboxRowRead(
      sessionId,
      plannerInboxRow.id,
      "planner group chat inbox row drained",
      REPLY_TIMEOUT_MS
    );
    await waitForMemberPostMessageActivity(
      sessionId,
      DEFAULT_AGENT_ORG_MEMBER_IDS.PLANNER,
      plannerBaselineUpdatedAt,
      "planner session advanced after group chat mention",
      REPLY_TIMEOUT_MS
    );
    await waitForRenderedGroupChatMessage({
      sender: plannerName,
      text: String(RUN_ID),
      label: "planner replies after group chat mention drain",
      timeout: REPLY_TIMEOUT_MS,
    });
    await assertNoMemberIntervention(
      plannerSessionId,
      "planner group chat mention must not interrupt"
    );
    const coordinatorMessage = `E2E group chat default coordinator ${RUN_ID}`;
    await sendRenderedChatPrompt(coordinatorMessage);
    const coordinatorInboxRow = await waitForInboxRow(
      sessionId,
      (row) => {
        const payload = parseInboxPayload(
          row,
          "default coordinator group chat"
        );
        return (
          row.senderAgentId === "_user" &&
          row.senderName === "User" &&
          row.recipientMemberId === AGENT_ORG_COORDINATOR_MEMBER_ID &&
          row.payloadKind === "plain" &&
          payload.text === coordinatorMessage
        );
      },
      "default coordinator group chat inbox row persisted"
    );
    if (!coordinatorInboxRow) {
      throw new Error(
        "default coordinator group chat inbox row was not returned"
      );
    }
    await waitForRenderedGroupChatUserTurn({
      text: coordinatorMessage,
      label: "default coordinator route",
    });
    await waitForAgentOrgRunView(
      sessionId,
      (view) =>
        (view?.inbox ?? []).some((row) => {
          const payload = parseInboxPayload(
            row,
            "default coordinator group chat"
          );
          return (
            row.senderAgentId === "_user" &&
            row.senderName === "User" &&
            row.recipientMemberId === AGENT_ORG_COORDINATOR_MEMBER_ID &&
            row.payloadKind === "plain" &&
            payload.text === coordinatorMessage
          );
        }),
      "default coordinator group chat inbox row persisted"
    );
    await assertNoMemberIntervention(
      sessionId,
      "default coordinator group chat must not interrupt"
    );
    await assertNoMemberIntervention(
      plannerSessionId,
      "planner remains non-interrupted after coordinator group chat"
    );

    const pauseResult = unwrap(
      await invokeE2E("agentOrgPauseRun", sessionId),
      "agentOrgPauseRun (group chat paused banner)"
    );
    if (pauseResult.transitioned !== false) {
      await waitForAgentOrgRunView(
        sessionId,
        (view) => view?.runStatus === "paused",
        "group chat run paused for inline Resume"
      );
      await refreshRenderedAgentOrgOverview("group chat paused banner refresh");
      await waitForGroupChatPausedBanner("group chat paused send resume");

      const pausedMessage = `E2E group chat paused send resumes ${RUN_ID}`;
      await sendRenderedChatPrompt(pausedMessage);
      const pausedInboxRow = await waitForInboxRow(
        sessionId,
        (row) => {
          const payload = parseInboxPayload(row, "paused group chat send");
          return (
            row.senderAgentId === "_user" &&
            row.recipientMemberId === AGENT_ORG_COORDINATOR_MEMBER_ID &&
            payload.text === pausedMessage
          );
        },
        "paused group chat inbox row persisted"
      );
      await waitForRenderedGroupChatUserTurn({
        text: pausedMessage,
        label: "paused group chat send resumes",
      });
      await waitForAgentOrgRunView(
        sessionId,
        (view) => view?.runStatus !== "paused",
        "group chat send while paused resumes run"
      );
      await waitForInboxRowRead(
        sessionId,
        pausedInboxRow.id,
        "paused group chat inbox row drained after resume",
        REPLY_TIMEOUT_MS
      );
      await browser.waitUntil(
        async () =>
          !(await execJS(
            js.exists('[data-testid="agent-org-group-chat-paused-banner"]')
          )),
        {
          timeout: RENDER_TIMEOUT_MS,
          interval: 250,
          timeoutMsg:
            "group chat paused banner did not disappear after sending a message",
        }
      );
    }
  });

  it("coordinator sets member to Plan, member submits plan, and coordinator approves it", async () => {
    const account = await getApiAccount();
    const model = selectPreferredModel(account);
    await configureCreatorForDefaultAgentOrg({ account, model });
    await selectRenderedExecMode("build");
    await selectRenderedDefaultAgentOrg();

    const launchPrompt = `E2E coordinator-controlled member plan approval ${RUN_ID}. Reply briefly.`;
    const sessionId = await sendFromRenderedCreator(launchPrompt);
    if (!sessionId) {
      throw new Error(
        "Agent Org plan approval launch did not create a session id"
      );
    }
    await waitForRenderedAssistantReply("Agent Org plan approval launch");

    let runId = null;
    let plannerSessionId = null;
    let plannerName = null;
    let coordinatorName = null;
    await waitForAgentOrgRunView(
      sessionId,
      (view) => {
        runId = view?.context?.runId ?? null;
        coordinatorName = view?.context?.coordinatorName ?? null;
        const planner = (view?.members ?? []).find(
          (member) => member.memberId === DEFAULT_AGENT_ORG_MEMBER_IDS.PLANNER
        );
        plannerSessionId = planner?.sessionRuntime?.sessionId ?? null;
        plannerName = planner?.name ?? null;
        return Boolean(
          view?.currentMemberId === AGENT_ORG_COORDINATOR_MEMBER_ID &&
          runId &&
          coordinatorName &&
          plannerName &&
          plannerSessionId
        );
      },
      "plan approval members materialized"
    );
    if (!runId || !plannerSessionId || !plannerName || !coordinatorName) {
      throw new Error(
        `Plan approval scenario did not materialize ids: ${JSON.stringify({ runId, plannerSessionId, plannerName, coordinatorName })}`
      );
    }

    const modeRequestId = `e2e-mode-plan-${RUN_ID}`;
    await sendCoordinatorOrgMessage(
      sessionId,
      {
        recipient_member_id: DEFAULT_AGENT_ORG_MEMBER_IDS.PLANNER,
        kind: "exec_mode_set_request",
        request_id: modeRequestId,
        mode: "plan",
        reason: `Planner must draft and submit a plan for approval ${RUN_ID}`,
      },
      "set planner to plan"
    );

    await waitForAgentOrgRunView(
      sessionId,
      (view) =>
        (view?.inbox ?? []).some((row) => {
          const payload = parseInboxPayload(row, "exec mode set request");
          return (
            row.payloadKind === "exec_mode_set_request" &&
            row.senderMemberId === AGENT_ORG_COORDINATOR_MEMBER_ID &&
            row.recipientMemberId === DEFAULT_AGENT_ORG_MEMBER_IDS.PLANNER &&
            payload.request_id === modeRequestId &&
            payload.mode === "plan"
          );
        }),
      "coordinator plan-mode request visible in run view"
    );

    await waitForSessionAggregateRow(
      plannerSessionId,
      (session) => session.sessionId === plannerSessionId,
      "planner session row after coordinator plan-mode request"
    );
    await waitForSessionOrgRuntimeSnapshot(
      plannerSessionId,
      (snapshot) =>
        snapshot.isOrgMember === true &&
        (snapshot.registeredOrgToolNames ?? []).includes("create_plan") &&
        (snapshot.requestedExecMode === "plan" ||
          snapshot.hasPrePlanMode === true),
      "planner received coordinator Plan-mode request without user chat"
    );
    await assertNoMemberIntervention(
      plannerSessionId,
      "coordinator plan-mode request"
    );

    const planTitle = `E2E Member Plan ${RUN_ID}`;
    const planContent = `Planner proposal ${RUN_ID}: inspect the target, make a minimal change, then verify with focused E2E before wider regression checks.`;
    await executeCreatePlanAsMember(
      plannerSessionId,
      planTitle,
      planContent,
      "planner submits plan"
    );
    await waitForSessionOrgRuntimeSnapshot(
      plannerSessionId,
      (snapshot) => snapshot.hasPlanSlot === true,
      "planner plan slot exists after create_plan"
    );
    await assertNoMemberIntervention(plannerSessionId, "planner create_plan");

    const planRequestRow = await waitForPlanApprovalRequest(
      sessionId,
      DEFAULT_AGENT_ORG_MEMBER_IDS.PLANNER,
      planTitle,
      planContent,
      "planner submitted plan"
    );
    const planRequestPayload = parseInboxPayload(
      planRequestRow,
      "planner plan request"
    );
    if (!planRequestPayload.request_id) {
      throw new Error(
        `plan approval request did not expose request_id: ${JSON.stringify(planRequestRow)}`
      );
    }
    await assertRenderedInboxPinBarAbsent(
      "coordinator rendered planner plan request"
    );
    await assertNoCurrentPlanBuildSurface(
      "coordinator viewing member-submitted org plan request"
    );

    const forgedRequestResult = unwrap(
      await invokeE2E(
        "debugAgentOrgExecuteToolAsAgent",
        runId,
        DEFAULT_AGENT_ORG_MEMBER_IDS.PLANNER,
        "org_send_message",
        {
          recipient_member_id: AGENT_ORG_COORDINATOR_MEMBER_ID,
          kind: "plan_approval_request",
          request_id: `forged-plan-request-${RUN_ID}`,
          summary: "forged request should be rejected",
          text: "forged request should be rejected",
        }
      ),
      "debugAgentOrgExecuteToolAsAgent(forged plan request)"
    ).result;
    const forgedRequestError = String(forgedRequestResult?.error ?? "");
    if (
      forgedRequestResult?.ok !== false ||
      (!forgedRequestError.includes("not LLM-callable") &&
        !forgedRequestError.includes("not allowed"))
    ) {
      throw new Error(
        `forged plan_approval_request was not rejected correctly: ${JSON.stringify(forgedRequestResult)}`
      );
    }

    const peerApprovalResult = unwrap(
      await invokeE2E(
        "debugAgentOrgExecuteToolAsAgent",
        runId,
        DEFAULT_AGENT_ORG_MEMBER_IDS.IMPLEMENTER,
        "org_send_message",
        {
          recipient_member_id: DEFAULT_AGENT_ORG_MEMBER_IDS.PLANNER,
          kind: "plan_approval_response",
          request_id: planRequestPayload.request_id,
          accepted: true,
          feedback: "peer approval should be rejected",
          next_mode: "build",
        }
      ),
      "debugAgentOrgExecuteToolAsAgent(peer plan approval)"
    ).result;
    const peerApprovalError = String(peerApprovalResult?.error ?? "");
    if (
      peerApprovalResult?.ok !== false ||
      (!peerApprovalError.includes("restricted to the coordinator") &&
        !peerApprovalError.includes("not allowed"))
    ) {
      throw new Error(
        `peer plan_approval_response was not rejected correctly: ${JSON.stringify(peerApprovalResult)}`
      );
    }

    const rejectionFeedback = `Coordinator feedback ${RUN_ID}: narrow the plan to a reviewable first phase and include verification checkpoints.`;
    await sendCoordinatorOrgMessage(
      sessionId,
      {
        recipient_member_id: DEFAULT_AGENT_ORG_MEMBER_IDS.PLANNER,
        kind: "plan_approval_response",
        request_id: planRequestPayload.request_id,
        accepted: false,
        feedback: rejectionFeedback,
        next_mode: "plan",
      },
      "reject planner plan with feedback"
    );
    await waitForAgentOrgRunView(
      sessionId,
      (view) =>
        (view?.inbox ?? []).some((row) => {
          const payload = parseInboxPayload(row, "plan rejection response");
          return (
            row.payloadKind === "plan_approval_response" &&
            row.senderMemberId === AGENT_ORG_COORDINATOR_MEMBER_ID &&
            row.recipientMemberId === DEFAULT_AGENT_ORG_MEMBER_IDS.PLANNER &&
            payload.request_id === planRequestPayload.request_id &&
            payload.accepted === false &&
            String(payload.feedback ?? "").includes(rejectionFeedback)
          );
        }),
      "coordinator rejection visible in run view"
    );
    await clickRenderedMemberSwitcher(
      DEFAULT_AGENT_ORG_MEMBER_IDS.PLANNER,
      plannerSessionId
    );
    await waitForAgentOrgRunView(
      plannerSessionId,
      (view) => view?.currentMemberId === DEFAULT_AGENT_ORG_MEMBER_IDS.PLANNER,
      "planner active for rendered rejection feedback"
    );
    await assertRenderedInboxPinBarAbsent(
      "planner rendered coordinator rejection feedback"
    );
    await assertNoCurrentPlanBuildSurface(
      "planner viewing coordinator rejection feedback"
    );
    await assertNoMemberIntervention(plannerSessionId, "coordinator rejection");

    const revisedPlanTitle = `E2E Revised Member Plan ${RUN_ID}`;
    const revisedPlanContent = `Revised planner proposal ${RUN_ID}: first inspect the target and current tests, then implement the minimal safe change, then run focused verification before broader Agent Org regression coverage.`;
    await executeCreatePlanAsMember(
      plannerSessionId,
      revisedPlanTitle,
      revisedPlanContent,
      "planner submits revised plan"
    );
    const revisedPlanRequestRow = await waitForPlanApprovalRequest(
      sessionId,
      DEFAULT_AGENT_ORG_MEMBER_IDS.PLANNER,
      revisedPlanTitle,
      revisedPlanContent,
      "planner submitted revised plan"
    );
    const revisedPlanRequestPayload = parseInboxPayload(
      revisedPlanRequestRow,
      "planner revised plan request"
    );
    if (!revisedPlanRequestPayload.request_id) {
      throw new Error(
        `revised plan approval request did not expose request_id: ${JSON.stringify(revisedPlanRequestRow)}`
      );
    }
    unwrap(
      await invokeE2E("openSession", sessionId),
      "openSession(coordinator before revised plan request assertion)"
    );
    await waitForAgentOrgRunView(
      sessionId,
      (view) => view?.currentMemberId === AGENT_ORG_COORDINATOR_MEMBER_ID,
      "coordinator active before revised plan request assertion"
    );
    await assertRenderedInboxPinBarAbsent(
      "coordinator rendered planner revised plan request"
    );
    await assertNoCurrentPlanBuildSurface(
      "coordinator viewing member-submitted revised org plan request"
    );

    const approvalFeedback = `Approved revised plan by coordinator during E2E ${RUN_ID}`;
    await sendCoordinatorOrgMessage(
      sessionId,
      {
        recipient_member_id: DEFAULT_AGENT_ORG_MEMBER_IDS.PLANNER,
        kind: "plan_approval_response",
        request_id: revisedPlanRequestPayload.request_id,
        accepted: true,
        feedback: approvalFeedback,
        next_mode: "build",
      },
      "approve revised planner plan"
    );
    await waitForAgentOrgRunView(
      sessionId,
      (view) =>
        (view?.inbox ?? []).some((row) => {
          const payload = parseInboxPayload(
            row,
            "revised plan approval response"
          );
          return (
            row.payloadKind === "plan_approval_response" &&
            row.senderMemberId === AGENT_ORG_COORDINATOR_MEMBER_ID &&
            row.recipientMemberId === DEFAULT_AGENT_ORG_MEMBER_IDS.PLANNER &&
            payload.request_id === revisedPlanRequestPayload.request_id &&
            payload.accepted === true &&
            String(payload.feedback ?? "").includes(approvalFeedback)
          );
        }),
      "coordinator revised approval visible in run view"
    );
    await clickRenderedMemberSwitcher(
      DEFAULT_AGENT_ORG_MEMBER_IDS.PLANNER,
      plannerSessionId
    );
    await waitForAgentOrgRunView(
      plannerSessionId,
      (view) => view?.currentMemberId === DEFAULT_AGENT_ORG_MEMBER_IDS.PLANNER,
      "planner active for rendered approval feedback"
    );
    await assertRenderedInboxPinBarAbsent(
      "planner rendered coordinator approval feedback"
    );
    await assertNoCurrentPlanBuildSurface(
      "planner viewing coordinator approval feedback"
    );
    await waitForSessionOrgRuntimeSnapshot(
      plannerSessionId,
      (snapshot) => snapshot.hasPlanSlot === true,
      "planner keeps submitted plan before a member turn drains approval"
    );
    await assertNoMemberIntervention(plannerSessionId, "coordinator approval");

    await assertNoFalseFinality(
      plannerSessionId,
      runId,
      "coordinator-controlled member plan approval"
    );
  });
});
