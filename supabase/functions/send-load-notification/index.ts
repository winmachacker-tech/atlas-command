// Supabase Edge Function: send-load-notification - SIMPLIFIED VERSION
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')

interface LoadNotificationPayload {
  loadId: string
  status: string
  recipientEmail: string
}

serve(async (req) => {
  try {
    const { loadId, status, recipientEmail }: LoadNotificationPayload = await req.json()

    console.log('Received request:', { loadId, status, recipientEmail })

    if (!recipientEmail) {
      throw new Error('No recipient email provided')
    }

    // Simple email content
    const subject = `Load Update - Status: ${status}`
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Load Update</title>
      </head>
      <body style="font-family: Arial, sans-serif; padding: 20px; background-color: #f5f5f5;">
        <div style="max-width: 600px; margin: 0 auto; background-color: white; padding: 40px; border-radius: 8px;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 8px 8px 0 0; margin: -40px -40px 30px -40px;">
            <h1 style="color: white; margin: 0; font-size: 28px;">Atlas Command</h1>
          </div>
          
          <h2 style="color: #333; margin-bottom: 20px;">Load Status Update</h2>
          
          <p style="color: #666; font-size: 16px; line-height: 1.6;">
            Your load status has been updated to: <strong style="color: #667eea;">${status.toUpperCase()}</strong>
          </p>
          
          <div style="background-color: #f8f9ff; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 0; color: #666;"><strong>Load ID:</strong> ${loadId.substring(0, 8)}...</p>
          </div>
          
          <p style="color: #999; font-size: 14px; margin-top: 30px;">
            This is an automated notification from Atlas Command.
          </p>
        </div>
      </body>
      </html>
    `

    console.log('Sending email via Resend...')

    // Send email via Resend
    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Atlas Command <onboarding@resend.dev>',
        to: [recipientEmail],
        subject: subject,
        html: html,
      }),
    })

    const resendData = await resendResponse.json()
    console.log('Resend response:', resendData)

    if (!resendResponse.ok) {
      throw new Error(`Resend API error: ${JSON.stringify(resendData)}`)
    }

    return new Response(
      JSON.stringify({ success: true, emailId: resendData.id }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Error sending notification:', error)
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message,
        stack: error.stack 
      }),
      { 
        status: 500, 
        headers: { 'Content-Type': 'application/json' } 
      }
    )
  }
})