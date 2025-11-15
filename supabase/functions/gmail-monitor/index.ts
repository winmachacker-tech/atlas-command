// supabase/functions/gmail-monitor/index.ts
import { google } from 'googleapis';
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

serve(async (req) => {
  const { userId } = await req.json();
  
  // Get user's stored OAuth tokens from Supabase
  const { data: tokens } = await supabaseAdmin
    .from('email_integrations')
    .select('*')
    .eq('user_id', userId)
    .single();

  const oauth2Client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    'your-redirect-uri'
  );
  
  oauth2Client.setCredentials(tokens);
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  // Search for emails with BOL attachments
  const response = await gmail.users.messages.list({
    userId: 'me',
    q: 'has:attachment (subject:BOL OR subject:"Bill of Lading" OR subject:"rate confirmation") is:unread'
  });

  for (const message of response.data.messages || []) {
    const email = await gmail.users.messages.get({
      userId: 'me',
      id: message.id,
      format: 'full'
    });

    // Extract attachments
    const attachments = email.data.payload.parts
      ?.filter(part => part.filename && part.body.attachmentId)
      || [];

    for (const attachment of attachments) {
      const attachmentData = await gmail.users.messages.attachments.get({
        userId: 'me',
        messageId: message.id,
        id: attachment.body.attachmentId
      });

      // Decode base64 attachment
      const buffer = Buffer.from(attachmentData.data.data, 'base64');
      
      // Send to AI for extraction
      const extractedData = await extractLoadFromDocument(buffer, attachment.mimeType);
      
      // Create draft load with confidence score
      await supabaseAdmin.from('load_drafts').insert({
        organization_id: tokens.organization_id,
        source: 'email',
        email_id: message.id,
        extracted_data: extractedData,
        confidence_score: extractedData.confidence,
        status: 'pending_review',
        created_at: new Date().toISOString()
      });
      
      // Mark email as processed
      await gmail.users.messages.modify({
        userId: 'me',
        id: message.id,
        requestBody: {
          addLabelIds: ['PROCESSED'], // Create custom label
          removeLabelIds: ['UNREAD']
        }
      });
    }
  }

  return new Response(JSON.stringify({ processed: response.data.messages?.length || 0 }));
});