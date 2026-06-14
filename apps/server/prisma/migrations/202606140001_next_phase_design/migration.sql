-- AlterTable
ALTER TABLE `billingdetail` ADD COLUMN `billingRuleVersion` INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE `chargingorder` ADD COLUMN `pileQueueEnteredAt` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `chargingsession` ADD COLUMN `sessionStatus` ENUM('ACTIVE', 'CLOSED', 'ABORTED') NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE `user` MODIFY `role` VARCHAR(191) NOT NULL DEFAULT 'USER';

-- CreateTable
CREATE TABLE `Administrator` (
    `id` VARCHAR(191) NOT NULL,
    `username` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `adminName` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Administrator_username_key`(`username`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BillingRule` (
    `id` VARCHAR(191) NOT NULL,
    `period` ENUM('PEAK', 'FLAT', 'VALLEY') NOT NULL,
    `startMinute` INTEGER NOT NULL,
    `endMinute` INTEGER NOT NULL,
    `price` DOUBLE NOT NULL,
    `serviceFeeRate` DOUBLE NOT NULL DEFAULT 0.8,
    `version` INTEGER NOT NULL DEFAULT 1,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `BillingRule_active_version_idx`(`active`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `ChargingSession_pileId_sessionStatus_idx` ON `ChargingSession`(`pileId`, `sessionStatus`);

-- CreateIndex
CREATE INDEX `ChargingSession_orderId_sessionStatus_idx` ON `ChargingSession`(`orderId`, `sessionStatus`);
