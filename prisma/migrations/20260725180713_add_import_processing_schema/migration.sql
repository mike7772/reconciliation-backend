-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('pending', 'processing', 'completed', 'failed', 'cancelling', 'cancelled');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('low', 'medium', 'high');

-- CreateTable
CREATE TABLE "import" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'pending',
    "processedCount" INTEGER NOT NULL DEFAULT 0,
    "acceptedCount" INTEGER NOT NULL DEFAULT 0,
    "rejectedCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateCount" INTEGER NOT NULL DEFAULT 0,
    "checkpointOffset" BIGINT NOT NULL DEFAULT 0,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "import_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uploaded_file" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "storageBucket" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "checksum" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "uploaded_file_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "description" TEXT,
    "fingerprint" TEXT NOT NULL,
    "riskScore" INTEGER NOT NULL,
    "riskLevel" "RiskLevel" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rejected_record" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "rawValue" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rejected_record_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "import_idempotencyKey_key" ON "import"("idempotencyKey");

-- CreateIndex
CREATE INDEX "import_status_idx" ON "import"("status");

-- CreateIndex
CREATE UNIQUE INDEX "uploaded_file_importId_key" ON "uploaded_file"("importId");

-- CreateIndex
CREATE INDEX "transaction_importId_idx" ON "transaction"("importId");

-- CreateIndex
CREATE INDEX "transaction_currency_idx" ON "transaction"("currency");

-- CreateIndex
CREATE INDEX "transaction_riskLevel_idx" ON "transaction"("riskLevel");

-- CreateIndex
CREATE INDEX "transaction_merchantId_idx" ON "transaction"("merchantId");

-- CreateIndex
CREATE INDEX "transaction_accountId_idx" ON "transaction"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "transaction_providerId_transactionId_key" ON "transaction"("providerId", "transactionId");

-- CreateIndex
CREATE INDEX "rejected_record_importId_lineNumber_idx" ON "rejected_record"("importId", "lineNumber");

-- AddForeignKey
ALTER TABLE "uploaded_file" ADD CONSTRAINT "uploaded_file_importId_fkey" FOREIGN KEY ("importId") REFERENCES "import"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_importId_fkey" FOREIGN KEY ("importId") REFERENCES "import"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rejected_record" ADD CONSTRAINT "rejected_record_importId_fkey" FOREIGN KEY ("importId") REFERENCES "import"("id") ON DELETE CASCADE ON UPDATE CASCADE;

