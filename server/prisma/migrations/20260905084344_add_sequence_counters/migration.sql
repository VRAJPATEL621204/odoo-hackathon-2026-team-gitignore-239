-- CreateTable
CREATE TABLE "Sequence" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Sequence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Sequence_key_year_key" ON "Sequence"("key", "year");
