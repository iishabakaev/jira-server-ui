import { relations } from 'drizzle-orm'
import { users } from './users'
import { userSessions } from './sessions'
import { localCredentials } from './local_credentials'
import { jiraCredentials } from './jira_credentials'
import { projects } from './projects'
import { issueTypes, statuses, priorities, resolutions, linkTypes, fieldSchemas } from './metadata'
import { issues } from './issues'
import { issueLinks } from './issue_links'
import { comments } from './comments'
import { worklogs } from './worklogs'
import { attachments } from './attachments'
import { boards } from './boards'
import { sprints } from './sprints'
import { workflowPlans, workflowSteps, transitions } from './workflow'
import { conflicts } from './conflicts'
import { savedViews } from './saved_views'

// Граф связей Drizzle. Описывается отдельным файлом, чтобы не плодить
// циклические импорты в файлах самих таблиц. Используется relational queries.

export const usersRel = relations(users, ({ many, one }) => ({
  sessions: many(userSessions),
  localCredential: one(localCredentials),
  jiraCredentials: many(jiraCredentials),
  savedViews: many(savedViews),
}))

export const projectsRel = relations(projects, ({ many }) => ({
  issues: many(issues),
  boards: many(boards),
  fieldSchemas: many(fieldSchemas),
}))

export const boardsRel = relations(boards, ({ one, many }) => ({
  project: one(projects, { fields: [boards.projectId], references: [projects.id] }),
  sprints: many(sprints),
  savedViews: many(savedViews),
}))

export const sprintsRel = relations(sprints, ({ one, many }) => ({
  board: one(boards, { fields: [sprints.boardId], references: [boards.id] }),
  issues: many(issues),
}))

export const issuesRel = relations(issues, ({ one, many }) => ({
  project: one(projects, { fields: [issues.projectId], references: [projects.id] }),
  issueType: one(issueTypes, { fields: [issues.issueTypeId], references: [issueTypes.id] }),
  status: one(statuses, { fields: [issues.statusId], references: [statuses.id] }),
  priority: one(priorities, { fields: [issues.priorityId], references: [priorities.id] }),
  resolution: one(resolutions, { fields: [issues.resolutionId], references: [resolutions.id] }),
  sprint: one(sprints, { fields: [issues.sprintId], references: [sprints.id] }),
  comments: many(comments),
  worklogs: many(worklogs),
  attachments: many(attachments),
  // Связи issue: исходящие — там, где issue source; входящие — там, где target.
  outgoingLinks: many(issueLinks, { relationName: 'source' }),
  incomingLinks: many(issueLinks, { relationName: 'target' }),
  workflowPlans: many(workflowPlans),
}))

export const issueLinksRel = relations(issueLinks, ({ one }) => ({
  source: one(issues, {
    fields: [issueLinks.sourceIssueId],
    references: [issues.id],
    relationName: 'source',
  }),
  target: one(issues, {
    fields: [issueLinks.targetIssueId],
    references: [issues.id],
    relationName: 'target',
  }),
  linkType: one(linkTypes, { fields: [issueLinks.linkTypeId], references: [linkTypes.id] }),
}))

export const commentsRel = relations(comments, ({ one }) => ({
  issue: one(issues, { fields: [comments.issueId], references: [issues.id] }),
}))

export const worklogsRel = relations(worklogs, ({ one }) => ({
  issue: one(issues, { fields: [worklogs.issueId], references: [issues.id] }),
}))

export const attachmentsRel = relations(attachments, ({ one }) => ({
  issue: one(issues, { fields: [attachments.issueId], references: [issues.id] }),
}))

export const workflowPlansRel = relations(workflowPlans, ({ one, many }) => ({
  issue: one(issues, { fields: [workflowPlans.issueId], references: [issues.id] }),
  user: one(users, { fields: [workflowPlans.userId], references: [users.id] }),
  steps: many(workflowSteps),
}))

export const workflowStepsRel = relations(workflowSteps, ({ one }) => ({
  plan: one(workflowPlans, { fields: [workflowSteps.planId], references: [workflowPlans.id] }),
}))

export const transitionsRel = relations(transitions, ({ one }) => ({
  issueType: one(issueTypes, { fields: [transitions.issueTypeId], references: [issueTypes.id] }),
  fromStatus: one(statuses, { fields: [transitions.fromStatusId], references: [statuses.id] }),
  toStatus: one(statuses, { fields: [transitions.toStatusId], references: [statuses.id] }),
}))

export const savedViewsRel = relations(savedViews, ({ one }) => ({
  board: one(boards, { fields: [savedViews.boardId], references: [boards.id] }),
  owner: one(users, { fields: [savedViews.ownerId], references: [users.id] }),
}))

export const fieldSchemasRel = relations(fieldSchemas, ({ one }) => ({
  project: one(projects, { fields: [fieldSchemas.projectId], references: [projects.id] }),
  issueType: one(issueTypes, { fields: [fieldSchemas.issueTypeId], references: [issueTypes.id] }),
}))

export const conflictsRel = relations(conflicts, ({ one }) => ({
  user: one(users, { fields: [conflicts.userId], references: [users.id] }),
  resolver: one(users, { fields: [conflicts.resolvedBy], references: [users.id] }),
}))
