export const COMMENT_CHANGE_EVENT = 'wcf-comment-change';

export async function loadMentionableProfiles(sb) {
  if (!sb) return [];
  const {data, error} = await sb.rpc('list_comment_mentionable_profiles');
  if (error) return [];
  return data || [];
}

export async function listComments(sb, entityType, entityId, {limit = 50} = {}) {
  if (!sb) return [];
  if (!entityType || !entityId) return [];
  const {data, error} = await sb.rpc('list_comments', {
    p_entity_type: entityType,
    p_entity_id: entityId,
    p_limit: limit,
  });
  if (error) throw new Error(`listComments: ${error.message || String(error)}`);
  return data || [];
}

export async function countComments(sb, entityType, entityId) {
  if (!sb) return 0;
  if (!entityType || !entityId) return 0;
  const {data, error} = await sb.rpc('count_comments', {
    p_entity_type: entityType,
    p_entity_id: entityId,
  });
  if (error) return 0;
  return typeof data === 'number' ? data : 0;
}

export async function postComment(sb, {entityType, entityId, body, entityLabel, mentions = [], attachments = []}) {
  if (!sb) throw new Error('postComment: sb required');
  const {data, error} = await sb.rpc('post_comment', {
    p_entity_type: entityType,
    p_entity_id: entityId,
    p_body: body,
    p_entity_label: entityLabel || null,
    p_mentions: mentions,
    p_attachments: attachments,
  });
  if (error) throw new Error(`postComment: ${error.message || String(error)}`);
  window.dispatchEvent(new CustomEvent(COMMENT_CHANGE_EVENT));
  return data;
}

export async function editComment(sb, {commentId, body, mentions = [], attachments = []}) {
  if (!sb) throw new Error('editComment: sb required');
  const {data, error} = await sb.rpc('edit_comment', {
    p_comment_id: commentId,
    p_body: body,
    p_mentions: mentions,
    p_attachments: attachments,
  });
  if (error) throw new Error(`editComment: ${error.message || String(error)}`);
  window.dispatchEvent(new CustomEvent(COMMENT_CHANGE_EVENT));
  return data;
}

export async function deleteComment(sb, commentId) {
  if (!sb) throw new Error('deleteComment: sb required');
  const {data, error} = await sb.rpc('delete_comment', {
    p_comment_id: commentId,
  });
  if (error) throw new Error(`deleteComment: ${error.message || String(error)}`);
  window.dispatchEvent(new CustomEvent(COMMENT_CHANGE_EVENT));
  return data;
}

export async function listCommentEdits(sb, commentId) {
  if (!sb) return [];
  const {data, error} = await sb.rpc('list_comment_edits', {
    p_comment_id: commentId,
  });
  if (error) throw new Error(`listCommentEdits: ${error.message || String(error)}`);
  return data || [];
}
