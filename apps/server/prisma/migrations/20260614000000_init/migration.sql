-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `username` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `role` ENUM('USER', 'ADMIN') NOT NULL DEFAULT 'USER',
    `batteryCapacity` DOUBLE NOT NULL DEFAULT 60,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `User_username_key`(`username`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ChargingPile` (
    `id` VARCHAR(191) NOT NULL,
    `pileType` ENUM('FAST', 'SLOW') NOT NULL,
    `power` DOUBLE NOT NULL,
    `physicalState` ENUM('ON', 'OFF') NOT NULL DEFAULT 'OFF',
    `workingState` ENUM('IDLE', 'CHARGING', 'FAULT') NOT NULL DEFAULT 'IDLE',
    `totalChargeCount` INTEGER NOT NULL DEFAULT 0,
    `totalChargeDuration` DOUBLE NOT NULL DEFAULT 0,
    `totalChargeAmount` DOUBLE NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ChargingOrder` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `chargeMode` ENUM('FAST', 'SLOW') NOT NULL,
    `requestedAmount` DOUBLE NOT NULL,
    `queueNo` VARCHAR(191) NOT NULL,
    `status` ENUM('WAITING', 'IN_PILE_QUEUE', 'CHARGING', 'FINISHED', 'CANCELED', 'ABORTED') NOT NULL DEFAULT 'WAITING',
    `assignedPileId` VARCHAR(191) NULL,
    `submitTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `startedAt` DATETIME(3) NULL,
    `finishedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ChargingOrder_queueNo_idx`(`queueNo`),
    INDEX `ChargingOrder_status_idx`(`status`),
    INDEX `ChargingOrder_chargeMode_status_idx`(`chargeMode`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ChargingSession` (
    `id` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `pileId` VARCHAR(191) NOT NULL,
    `startTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `stopTime` DATETIME(3) NULL,
    `actualAmount` DOUBLE NULL,
    `stopReason` VARCHAR(191) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BillingDetail` (
    `id` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `sessionId` VARCHAR(191) NOT NULL,
    `generatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualAmount` DOUBLE NOT NULL,
    `duration` DOUBLE NOT NULL,
    `chargeFee` DOUBLE NOT NULL,
    `serviceFee` DOUBLE NOT NULL,
    `totalFee` DOUBLE NOT NULL,

    UNIQUE INDEX `BillingDetail_orderId_key`(`orderId`),
    UNIQUE INDEX `BillingDetail_sessionId_key`(`sessionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ChargingOrder` ADD CONSTRAINT `ChargingOrder_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ChargingOrder` ADD CONSTRAINT `ChargingOrder_assignedPileId_fkey` FOREIGN KEY (`assignedPileId`) REFERENCES `ChargingPile`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ChargingSession` ADD CONSTRAINT `ChargingSession_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `ChargingOrder`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ChargingSession` ADD CONSTRAINT `ChargingSession_pileId_fkey` FOREIGN KEY (`pileId`) REFERENCES `ChargingPile`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BillingDetail` ADD CONSTRAINT `BillingDetail_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `ChargingOrder`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BillingDetail` ADD CONSTRAINT `BillingDetail_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `ChargingSession`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

