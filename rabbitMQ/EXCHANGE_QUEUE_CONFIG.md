# RabbitMQ Exchange and Queue Configuration

## Overview

This document outlines the RabbitMQ exchange and queue configuration for the Profile Service.

## Exchanges

### 1. `portal.events` Exchange

- **Purpose**: Events from Portal Service to Profile Service
- **Type**: Topic Exchange
- **Routing Pattern**: `profile.application.create`

### 2. `application.events` Exchange

- **Purpose**: Application approval events from Profile Service
- **Type**: Topic Exchange
- **Routing Pattern**: `applications.review.approved.v1`

### 3. `membership.events` Exchange

- **Purpose**: Membership creation events from Profile Service
- **Type**: Topic Exchange
- **Routing Pattern**: `members.member.created.requested.v1`

### 4. `batch.events` Exchange

- **Purpose**: Async batch processing (request + completion)
- **Type**: Topic Exchange
- **Routing Patterns**: `batch.process.requested`, `batch.process.completed`

## Queues

### 1. `profile.portal.events`

- **Exchange**: `portal.events`
- **Routing Key**: `profile.application.create`
- **Purpose**: Consumes application creation events from Portal Service
- **Handler**: `ProfileApplicationCreateEventListener`

### 2. `profile.application.events`

- **Exchange**: `application.events`
- **Routing Key**: `applications.review.approved.v1`
- **Purpose**: Consumes application approval events (internal)
- **Handler**: `ApplicationApprovalEventListener`

### 3. `profile.membership.events`

- **Exchange**: `membership.events`
- **Routing Key**: `members.member.created.requested.v1`
- **Purpose**: Consumes membership creation events (internal)
- **Handler**: `ApplicationApprovalEventListener`

### 4. `profile.batch.process`

- **Exchange**: `batch.events`
- **Routing Key**: `batch.process.requested`
- **Purpose**: Background processing of batch details (chunked calls to account-service)
- **Handler**: `runBatchProcessing` from `batch.process.job.service.js`; publishes `batch.process.completed` when done

## Event Flow

### Application Approval Process

1. **Profile Service** publishes `APPLICATION_REVIEW_APPROVED` to `application.events` exchange
2. **Portal Service** consumes from `portal.application.events` queue (to update application status)
3. **Profile Service** publishes `MEMBER_CREATED_REQUESTED` to `membership.events` exchange
4. **Subscription Service** consumes from `subscription.membership.events` queue (to create membership)

### Application Creation Process

1. **Portal Service** publishes `profile.application.create` to `portal.events` exchange
2. **Profile Service** consumes from `profile.portal.events` queue (to create application records)

### Batch Process (async)

1. **Profile Service** API receives `POST .../process/:batchDetailId`, publishes `batch.process.requested` to `batch.events`, returns **202 Accepted**
2. **Profile Service** consumer on `profile.batch.process` runs `runBatchProcessing` (chunks → account-service), updates batch status to `processed` or `failed`
3. **Profile Service** publishes `batch.process.completed` to `batch.events` (for future WebSocket/notification service)
4. Frontend polls `GET .../batch-details/:id` until `batchStatus` is `processed` or `failed`, then shows toaster

## Event Publishers

### ApplicationApprovalEventPublisher

- **Publishes to**: `application.events` and `membership.events` exchanges
- **Events**:
  - `APPLICATION_REVIEW_APPROVED`
  - `MEMBER_CREATED_REQUESTED`

## Event Listeners

### ProfileApplicationCreateEventListener

- **Consumes from**: `profile.portal.events` queue
- **Events**: `profile.application.create`

### ApplicationApprovalEventListener

- **Consumes from**: `profile.application.events` and `profile.membership.events` queues
- **Events**:
  - `applications.review.approved.v1`
  - `members.member.created.requested.v1`

## Dead Letter Queues

All queues have corresponding DLQs:

- `profile.portal.events.dlq`
- `profile.application.events.dlq`
- `profile.membership.events.dlq`
- `profile.batch.process.dlq` (if configured)

## Configuration

- **Message TTL**: 1 hour (3600000 ms)
- **Prefetch**: 10 messages
- **Durable**: true
- **Auto-Delete**: false
