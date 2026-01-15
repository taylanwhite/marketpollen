import { Contact, FollowUpSuggestion } from '../types';

export function generateFollowUpSuggestions(contact: Contact): FollowUpSuggestion[] {
  const suggestions: FollowUpSuggestion[] = [];
  const now = new Date();
  
  // If contact is new, suggest initial follow-up in 2-3 days
  if (contact.status === 'new' || !contact.lastReachoutDate) {
    const suggestedDate = new Date(now);
    suggestedDate.setDate(suggestedDate.getDate() + 2);
    
    suggestions.push({
      suggestedDate,
      message: `Follow up with ${contact.firstName || 'contact'} to discuss their needs and how we can help.`,
      type: 'email',
      priority: 'high'
    });
  } else {
    // Calculate days since last follow-up
    const daysSinceLastFollowUp = Math.floor(
      (now.getTime() - contact.lastReachoutDate.getTime()) / (1000 * 60 * 60 * 24)
    );
    
    // If it's been more than 7 days, suggest urgent follow-up
    if (daysSinceLastFollowUp > 7) {
      suggestions.push({
        suggestedDate: now,
        message: `It's been ${daysSinceLastFollowUp} days since last contact. Reconnect with ${contact.firstName || 'contact'} to maintain engagement.`,
        type: 'call',
        priority: 'high'
      });
    } else if (daysSinceLastFollowUp > 3) {
      // Medium priority follow-up
      suggestions.push({
        suggestedDate: new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000),
        message: `Send a follow-up email to ${contact.firstName || 'contact'} with additional information or resources.`,
        type: 'email',
        priority: 'medium'
      });
    }
  }
  
  // If contact has recent reachouts indicating interest, suggest meeting
  const latestNote = contact.reachouts[contact.reachouts.length - 1]?.note || '';
  if (latestNote && /interested|meeting|demo|trial/i.test(latestNote)) {
    suggestions.push({
      suggestedDate: new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000),
      message: `Schedule a meeting or demo with ${contact.firstName || 'contact'} based on their interest.`,
      type: 'meeting',
      priority: 'high'
    });
  }
  
  // Default suggestion if no specific suggestions
  if (suggestions.length === 0) {
    suggestions.push({
      suggestedDate: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000),
      message: `Check in with ${contact.firstName || 'contact'} to see how things are going.`,
      type: 'email',
      priority: 'medium'
    });
  }
  
  return suggestions.sort((a, b) => {
    // Sort by priority (high > medium > low) then by date
    const priorityOrder = { high: 3, medium: 2, low: 1 };
    if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
      return priorityOrder[b.priority] - priorityOrder[a.priority];
    }
    return a.suggestedDate.getTime() - b.suggestedDate.getTime();
  });
}
