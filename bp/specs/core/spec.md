# Core Specification

## Purpose

Core business logic — domain rules, state transitions, data transformations.

## Requirements

### Requirement: Input validation
The system SHALL validate all inputs before processing.

#### Scenario: Valid input
- **GIVEN** input that meets all type and constraint requirements
- **WHEN** the system processes the input
- **THEN** the system SHALL return the expected result

#### Scenario: Invalid input
- **GIVEN** input that violates type or constraint requirements
- **WHEN** the system processes the input
- **THEN** the system SHALL reject the input with a descriptive error message
