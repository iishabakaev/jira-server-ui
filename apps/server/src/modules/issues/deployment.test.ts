import { describe, expect, test } from 'bun:test'
import {
  buildDeploymentInfo,
  classifyDeploymentByStatus,
  isDevopsArtifactType,
  isEpicType,
} from './deployment'

// Чистый юнит-тест без DB — повторяет паттерн activity.test.ts. Покрывает
// все три ветки классификатора (deployed/deploying/not-deployed) + edge
// cases case-folding и unknown-имя.

describe('classifyDeploymentByStatus', () => {
  test('deployed statuses', () => {
    expect(classifyDeploymentByStatus('Ready To Production')).toBe('deployed')
    expect(classifyDeploymentByStatus('Done')).toBe('deployed')
    expect(classifyDeploymentByStatus('Waiting Feedback (Live)')).toBe('deployed')
  })

  test('deploying statuses', () => {
    expect(classifyDeploymentByStatus('Deploying to production')).toBe('deploying')
    expect(classifyDeploymentByStatus('Stress Testing')).toBe('deploying')
  })

  test('not-deployed fallback', () => {
    expect(classifyDeploymentByStatus('To Do')).toBe('not-deployed')
    expect(classifyDeploymentByStatus('Scoring')).toBe('not-deployed')
    expect(classifyDeploymentByStatus('In Progress')).toBe('not-deployed')
    expect(classifyDeploymentByStatus('Unknown status')).toBe('not-deployed')
  })

  test('case-insensitive + trim', () => {
    expect(classifyDeploymentByStatus('  DEPLOYING TO PRODUCTION  ')).toBe('deploying')
    expect(classifyDeploymentByStatus('done')).toBe('deployed')
  })
})

describe('isDevopsArtifactType', () => {
  test('matches Platform Devops Task variants', () => {
    expect(isDevopsArtifactType('Platform Devops Task')).toBe(true)
    expect(isDevopsArtifactType('platform devops task')).toBe(true)
    expect(isDevopsArtifactType('  Platform Devops Task  ')).toBe(true)
    expect(isDevopsArtifactType('DevOps Task')).toBe(true)
    expect(isDevopsArtifactType('Platform Task')).toBe(true)
  })

  test('rejects non-artifact types', () => {
    expect(isDevopsArtifactType('Task')).toBe(false)
    expect(isDevopsArtifactType('Epic')).toBe(false)
    expect(isDevopsArtifactType('Change task')).toBe(false)
    expect(isDevopsArtifactType('Bug')).toBe(false)
  })

  test('safe on null/empty', () => {
    expect(isDevopsArtifactType(null)).toBe(false)
    expect(isDevopsArtifactType(undefined)).toBe(false)
    expect(isDevopsArtifactType('')).toBe(false)
    expect(isDevopsArtifactType('   ')).toBe(false)
  })
})

describe('isEpicType', () => {
  test('matches epic with case/whitespace tolerance', () => {
    expect(isEpicType('Epic')).toBe(true)
    expect(isEpicType('epic')).toBe(true)
    expect(isEpicType('  Epic  ')).toBe(true)
  })

  test('rejects everything else', () => {
    expect(isEpicType('Task')).toBe(false)
    expect(isEpicType('Story')).toBe(false)
    expect(isEpicType('Platform Devops Task')).toBe(false)
    expect(isEpicType(null)).toBe(false)
    expect(isEpicType(undefined)).toBe(false)
    expect(isEpicType('')).toBe(false)
  })
})

describe('buildDeploymentInfo', () => {
  test('embeds artifact key, status name, and computed state', () => {
    const info = buildDeploymentInfo('ABC-100', 'Ready To Production')
    expect(info).toEqual({
      state: 'deployed',
      statusName: 'Ready To Production',
      devopsTaskKey: 'ABC-100',
    })
  })

  test('propagates not-deployed for non-matching status', () => {
    const info = buildDeploymentInfo('XYZ-1', 'To Do')
    expect(info.state).toBe('not-deployed')
    expect(info.devopsTaskKey).toBe('XYZ-1')
  })
})
