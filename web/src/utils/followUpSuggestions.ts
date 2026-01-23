import { Contact, FollowUpSuggestion } from '../types';
import { generateFollowUpSuggestion } from './openai';

/**
 * Generate AI-powered follow-up suggestions for a contact
 * Falls back to simple rules if AI is unavailable
 */
export async function generateFollowUpSuggestions(contact: Contact): Promise<FollowUpSuggestion[]> {
  const suggestions: FollowUpSuggestion[] = [];
  const now = new Date();
  
  try {
    // Use AI to generate intelligent follow-up suggestion
    const aiSuggestion = await generateFollowUpSuggestion({
      firstName: contact.firstName || undefined,
      lastName: contact.lastName || undefined,
      reachouts: contact.reachouts.map(r => ({
        date: r.date instanceof Date ? r.date : new Date(r.date),
        note: r.note || '',
        type: r.type || 'other',
        donation: r.donation
      })),
      personalDetails: contact.personalDetails || undefined,
      status: contact.status || undefined,
      email: contact.email || undefined,
      phone: contact.phone || undefined
    });

    const suggestedDate = new Date(aiSuggestion.suggestedDate);
    
    suggestions.push({
      suggestedDate,
      message: aiSuggestion.message,
      type: aiSuggestion.suggestedMethod,
      priority: aiSuggestion.priority,
      contactId: contact.id,
      contactName: `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || contact.email || 'Contact'
    });
  } catch (error) {
    console.error('AI follow-up generation failed, using fallback:', error);
    
    // Fallback to rule-based suggestions
    if (contact.status === 'new' || !contact.lastReachoutDate) {
      const suggestedDate = new Date(now);
      suggestedDate.setDate(suggestedDate.getDate() + 2);
      
      suggestions.push({
        suggestedDate,
        message: `Follow up with ${contact.firstName || 'contact'} to discuss their needs and how we can help.`,
        type: contact.email ? 'email' : contact.phone ? 'call' : 'email',
        priority: 'high',
        contactId: contact.id,
        contactName: `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || contact.email || 'Contact'
      });
    } else {
      const daysSinceLastFollowUp = Math.floor(
        (now.getTime() - contact.lastReachoutDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      
      if (daysSinceLastFollowUp > 7) {
        suggestions.push({
          suggestedDate: now,
          message: `It's been ${daysSinceLastFollowUp} days since last contact. Reconnect with ${contact.firstName || 'contact'} to maintain engagement.`,
          type: contact.phone ? 'call' : 'email',
          priority: 'high',
          contactId: contact.id,
          contactName: `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || contact.email || 'Contact'
        });
      } else if (daysSinceLastFollowUp > 3) {
        const suggestedDate = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
        suggestions.push({
          suggestedDate,
          message: `Send a follow-up ${contact.email ? 'email' : 'call'} to ${contact.firstName || 'contact'} with additional information or resources.`,
          type: contact.email ? 'email' : 'call',
          priority: 'medium',
          contactId: contact.id,
          contactName: `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || contact.email || 'Contact'
        });
      }
    }
    
    // If contact has recent reachouts indicating interest, suggest meeting
    const latestNote = contact.reachouts[contact.reachouts.length - 1]?.note || '';
    if (latestNote && /interested|meeting|demo|trial/i.test(latestNote)) {
      const suggestedDate = new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000);
      suggestions.push({
        suggestedDate,
        message: `Schedule a meeting or demo with ${contact.firstName || 'contact'} based on their interest.`,
        type: 'meeting',
        priority: 'high',
        contactId: contact.id,
        contactName: `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || contact.email || 'Contact'
      });
    }
    
    // Default suggestion if no specific suggestions
    if (suggestions.length === 0) {
      const suggestedDate = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
      suggestions.push({
        suggestedDate,
        message: `Check in with ${contact.firstName || 'contact'} to see how things are going.`,
        type: contact.email ? 'email' : 'call',
        priority: 'medium',
        contactId: contact.id,
        contactName: `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || contact.email || 'Contact'
      });
    }
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
