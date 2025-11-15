// supabase/functions/inbound-email/index.ts
serve(async (req) => {
  const formData = await req.formData();
  
  const to = formData.get('to'); // loads-abc123@atlas-command.com
  const from = formData.get('from');
  const subject = formData.get('subject');
  const text = formData.get('text');
  
  // Extract org ID from email
  const orgId = to.match(/loads-(.+)@/)?.[1];
  
  // Get attachments
  const attachmentCount = parseInt(formData.get('attachments') || '0');
  const documents = [];
  
  for (let i = 1; i <= attachmentCount; i++) {
    const file = formData.get(`attachment${i}`);
    documents.push({
      filename: formData.get(`attachment-info${i}`),
      content: file
    });
  }

  // Process with AI
  const extractedLoad = await extractLoadData(documents, text, subject);
  
  // Create draft load
  await supabaseAdmin.from('load_drafts').insert({
    organization_id: orgId,
    source: 'email_forward',
    sender_email: from,
    subject: subject,
    extracted_data: extractedLoad,
    confidence_score: extractedLoad.confidence,
    status: 'pending_review'
  });
  
  return new Response('OK', { status: 200 });
});