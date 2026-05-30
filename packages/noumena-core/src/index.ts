// ID generation
export {
  generateId,
  generateTestId,
  createTestClock,
  advanceTestClock,
  isValidId,
  ID_PATTERNS,
} from "./ids.js";
export type { IdPrefix, TestClock } from "./ids.js";

// Path safety
export { validateVaultRelativePath } from "./pathSafety.js";
export type { PathValidationResult } from "./pathSafety.js";

// Vault operations
export { openInitializedVault, initVault } from "./vault.js";
export type {
  VaultHandle,
  OpenVaultResult,
  InitVaultResult,
} from "./vault.js";

// Database operations
export {
  openDatabase,
  initializeSchema,
  createVaultDatabase,
  upsertDocument,
  getDocument,
  replaceBlocks,
  getBlocks,
  insertPatch,
  getPatch,
  getPatchByClientId,
  getLatestAppliedPatch,
  updatePatchStatus,
  insertReview,
  getReview,
  updateReviewStatus,
  insertHistoryEvent,
  getHistoryEvents,
  writeSnapshot,
  writePatchJson,
  writeReviewDiff,
} from "./db.js";
export type {
  DocumentRecord,
  BlockRecord,
  PatchRecord,
  ReviewRecord,
  HistoryEventRecord,
} from "./db.js";

// Lock operations
export { acquireWriteLock, releaseWriteLock } from "./lock.js";
export type { LockOwner, AcquireLockResult } from "./lock.js";

// Write transaction
export { runWriteTransaction } from "./writeTransaction.js";
export type {
  WriteTransactionOptions,
  WriteTransactionContext,
  WriteTransactionOutcome,
  WriteTransactionApplied,
  WriteTransactionQueued,
  WriteTransactionRejected,
  WriteTransactionNoop,
  WriteTransactionResult,
} from "./writeTransaction.js";

// Patch evaluation engine
export {
  evaluatePatch,
  checkIdempotency,
  resolveTarget,
  buildDocumentState,
} from "./evaluatePatch.js";
export type {
  PatchOp,
  ParsedPatch,
  EvalWarning,
  OpEvalResult,
  PatchVerdict,
  PatchEvalResult,
  DocumentState,
} from "./evaluatePatch.js";

// Patch schema validation
export {
  validatePatchSchema,
  assertPatchSchema,
  readAndValidatePatchJson,
  PatchSchemaValidationError,
} from "./patchSchema.js";
export type { PatchSchemaError, PatchValidationResult } from "./patchSchema.js";

// Types
export type {
  DocumentId,
  BlockId,
  NoumenaRole,
  ConflictPolicy,
  NoumenaMetadataV1,
  NoumenaBlock,
  NoumenaArticle,
  NoumenaDocument,
  FileClass,
  ParseResult,
  BlockElement,
  BlockChild,
  SerializableElement,
} from "./types.js";

// HTML parser
export { parseNoumenaHtml } from "./parseNoumenaHtml.js";

// Document validation
export { validateDocument } from "./validateDocument.js";
export type { ValidationIssue, ValidationResult } from "./validateDocument.js";

// Document create
export { createDocument } from "./docCreate.js";
export type { DocCreateResult, DocCreateSuccess, DocCreateError } from "./docCreate.js";

// Document info
export { getDocInfo } from "./docInfo.js";
export type { DocInfoResult, DocInfoSuccess, DocInfoError, RoleInfo } from "./docInfo.js";

// Vault doctor
export { runDoctor } from "./doctor.js";
export type { DoctorResult, DoctorSuccess, DoctorError, DoctorIssue } from "./doctor.js";

// Canonical serialization
export { canonicalSerialize, canonicalJsonSerialize } from "./canonicalSerialize.js";
export { canonicalSerializeBlock } from "./canonicalSerializeBlock.js";

// Clock boundary
export { systemClock, fixedClock } from "./clock.js";
export type { Clock } from "./clock.js";

// Revision and block hash computation
export {
  sha256,
  computeRevision,
  computeRevisionFromDocument,
  computeBlockHash,
  computeAllBlockHashes,
} from "./computeRevision.js";

// Apply patch (mutation ops)
export {
  applyPatch,
  escapeHtml,
  sanitizeSummaryFragment,
} from "./applyPatch.js";
export type {
  ApplyPatchResult,
  SanitizeResult,
} from "./applyPatch.js";

// Patch submit & dry-run
export {
  submitPatch,
  dryRunPatch,
} from "./patchSubmit.js";
export type {
  PatchSubmitResult,
  PatchSubmitSuccess,
  PatchSubmitError,
  PatchDryRunResult,
} from "./patchSubmit.js";

// Patch operations (approve, reject, rollback, status, show)
export {
  approvePatch,
  rejectPatch,
  rollbackPatch,
  patchStatus,
  patchShow,
} from "./patchOps.js";
export type {
  PatchOpResult,
  PatchOpSuccess,
  PatchOpError,
} from "./patchOps.js";

// Explicit core boundaries
export { indexDocument } from "./indexDocument.js";
export { recordHistoryEvent } from "./history.js";
export { writeReviewJson, storeReview } from "./reviewStore.js";
export { buildBlockDiffs } from "./blockDiff.js";
export type { BlockDiff } from "./blockDiff.js";

// Fixture loading helpers (test utilities)
export {
  fixturePath,
  readFixture,
  readFixtureBytes,
  readFixtureJson,
  schemaPath,
  readSchema,
  loadNativeFixture,
  loadMalformedFixture,
  loadPatchFixture,
  loadExpectedFixture,
  loadValidFixture,
  loadInvalidFixture,
} from "./fixtures.js";
export type { FixtureCategory } from "./fixtures.js";
