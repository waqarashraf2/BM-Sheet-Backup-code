import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { jsPDF } from 'jspdf';
import { AlertCircle, ArrowLeft, Brush, Edit3, FileText, Sparkles, Trash2 } from 'lucide-react';
import { Button, PageHeader } from '../../components/ui';
import BenchmarkLogo from '../../components/ui/BenchmarkLogo';
import { hrService } from '../../services';

type SignatureFont = 'GreatVibes' | 'AlexBrush' | 'Playball' | 'DancingScript' | 'Parisienne' | 'HerrVonMuellerhoff';

export default function DocumentGenerator() {
  const { userId, docType } = useParams<{ userId: string; docType: string }>();
  const navigate = useNavigate();

  // User state
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Form Fields
  const [name, setName] = useState('');
  const [cnic, setCnic] = useState('');
  const [relationshipType, setRelationshipType] = useState<'S/O' | 'D/O' | 'W/O' | ''>('');
  const [relativeName, setRelativeName] = useState('');
  const [joiningDate, setJoiningDate] = useState('');
  const [stipend, setStipend] = useState('28000');
  const [projectName, setProjectName] = useState('ESOFT Photos');

  // Employee Signature state
  const [signatureMode, setSignatureMode] = useState<'draw' | 'type'>('draw');
  const [typedName, setTypedName] = useState('');
  const [selectedFont, setSelectedFont] = useState<SignatureFont>('GreatVibes');

  // Employee Canvas ref
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [canvasHasDrawing, setCanvasHasDrawing] = useState(false);

  // HR Signature state
  const [hrName, setHrName] = useState('Ali Shan');
  const [hrSignatureMode, setHrSignatureMode] = useState<'draw' | 'type'>('type');
  const [hrTypedName, setHrTypedName] = useState('Ali Shan');
  const [hrSelectedFont, setHrSelectedFont] = useState<SignatureFont>('GreatVibes');

  // HR Canvas ref
  const hrCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isHrDrawing, setIsHrDrawing] = useState(false);
  const [hrCanvasHasDrawing, setHrCanvasHasDrawing] = useState(false);

  // Load user details
  useEffect(() => {
    if (!userId) return;
    hrService.userDetail(Number(userId))
      .then((res: any) => {
        const u = res.data.user;
        setName(u.name || '');
        setTypedName(u.name || '');
        setProjectName(u.project?.name || 'ESOFT Photos');
        if (u.salary) {
          setStipend(String(Math.round(Number(u.salary))));
        } else if (u.joining_salary) {
          setStipend(String(Math.round(Number(u.joining_salary))));
        }
        
        // Default to user's created_at date
        if (u.created_at) {
          setJoiningDate(new Date(u.created_at).toISOString().split('T')[0]);
        } else {
          setJoiningDate(new Date().toISOString().split('T')[0]);
        }
      })
      .catch((err) => {
        console.error(err);
        setError('Failed to load employee details.');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [userId]);

  const handleCancelOrBack = () => {
    if (window.opener) {
      window.close();
    } else {
      navigate('/hr-panel');
    }
  };

  // Configure Canvas Drawing (Employee)
  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';

    const rect = canvas.getBoundingClientRect();
    let clientX, clientY;
    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    ctx.beginPath();
    ctx.moveTo(clientX - rect.left, clientY - rect.top);
    setIsDrawing(true);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    let clientX, clientY;
    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    ctx.lineTo(clientX - rect.left, clientY - rect.top);
    ctx.stroke();
    setCanvasHasDrawing(true);
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setCanvasHasDrawing(false);
  };

  // Configure Canvas Drawing (HR)
  const startHrDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = hrCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';

    const rect = canvas.getBoundingClientRect();
    let clientX, clientY;
    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    ctx.beginPath();
    ctx.moveTo(clientX - rect.left, clientY - rect.top);
    setIsHrDrawing(true);
  };

  const drawHr = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isHrDrawing) return;
    const canvas = hrCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    let clientX, clientY;
    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    ctx.lineTo(clientX - rect.left, clientY - rect.top);
    ctx.stroke();
    setHrCanvasHasDrawing(true);
  };

  const stopHrDrawing = () => {
    setIsHrDrawing(false);
  };

  const clearHrCanvas = () => {
    const canvas = hrCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHrCanvasHasDrawing(false);
  };

  // Font choices for Option B (Type-to-Sign) with CSS mapping
  const fontStyles: Record<SignatureFont, string> = {
    GreatVibes: 'font-["Great_Vibes",cursive] text-4xl italic tracking-wider',
    AlexBrush: 'font-["Alex_Brush",cursive] text-4xl tracking-wider',
    Playball: 'font-["Playball",cursive] text-3xl tracking-wide',
    DancingScript: 'font-["Dancing_Script",cursive] text-3xl italic tracking-wide',
    Parisienne: 'font-["Parisienne",cursive] text-3xl tracking-widest',
    HerrVonMuellerhoff: 'font-["Herr_Von_Muellerhoff",cursive] text-4xl italic tracking-widest',
  };

  // Format Pakistani Date (DD/MM/YYYY)
  const formatPakistaniDate = (dateStr: string) => {
    if (!dateStr) return '';
    const [year, month, day] = dateStr.split('-');
    return `${day}/${month}/${year}`;
  };

  const formatLongDate = (dateStr: string) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { day: '2-digit', month: 'long', year: 'numeric' });
  };

  // Helper to calculate end date (1 year later)
  const getEndDate = (dateStr: string) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    date.setFullYear(date.getFullYear() + 1);
    return date.toISOString().split('T')[0];
  };

  // Draw Benchmark Logo helper on jsPDF
  const drawPDFLogo = (doc: jsPDF, x: number, y: number) => {
    // Orange bar
    doc.setFillColor(196, 92, 38); // #C45C26
    doc.rect(x, y, 2.5, 10, 'F');
    // Teal upper triangle
    doc.setFillColor(42, 167, 160); // #2AA7A0
    doc.triangle(x + 3.5, y, x + 3.5, y + 5, x + 8.5, y, 'F');
    // Teal lower triangle
    doc.triangle(x + 3.5, y + 5, x + 3.5, y + 10, x + 8.5, y + 10, 'F');
    
    // Benchmark Text
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(42, 167, 160);
    doc.text('BENCHMARK', x + 11, y + 7.5);
    doc.setTextColor(0, 0, 0); // reset
  };

  // Helper to get relationship string (S/O, D/O, W/O)
  const getFullEmployeeNameString = () => {
    if (relationshipType && relativeName.trim()) {
      return `${name} ${relationshipType} ${relativeName.trim()}`;
    }
    return name;
  };

  // Helper to generate signature base64
  const generateSignatureBase64 = (mode: 'draw' | 'type', canvas: HTMLCanvasElement | null, typedText: string, font: SignatureFont, hasDrawing: boolean) => {
    if (mode === 'draw') {
      if (!hasDrawing) return '';
      return canvas?.toDataURL('image/png') || '';
    } else {
      if (!typedText.trim()) return '';
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = 400;
      tempCanvas.height = 100;
      const ctx = tempCanvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
        ctx.fillStyle = '#000000';
        
        let fontName = 'Georgia';
        if (font === 'GreatVibes') fontName = 'Brush Script MT, Great Vibes, cursive';
        else if (font === 'AlexBrush') fontName = 'Lucida Handwriting, Alex Brush, cursive';
        else if (font === 'Playball') fontName = 'Comic Sans MS, Playball, cursive';
        else if (font === 'DancingScript') fontName = 'Dancing Script, cursive';
        else if (font === 'Parisienne') fontName = 'Parisienne, cursive';
        else if (font === 'HerrVonMuellerhoff') fontName = 'Herr Von Muellerhoff, cursive';

        ctx.font = `italic 36px ${fontName}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(typedText, 200, 50);
        return tempCanvas.toDataURL('image/png');
      }
      return '';
    }
  };

  // Generate & Upload PDF
  const handleGenerateAndUpload = async () => {
    if (!userId || !docType) return;
    setSubmitting(true);
    setError('');

    try {
      // 1. Capture employee signature image
      const signatureImgBase64 = generateSignatureBase64(signatureMode, canvasRef.current, typedName, selectedFont, canvasHasDrawing);
      if (!signatureImgBase64) {
        throw new Error('Please draw or type the Employee signature.');
      }

      // 2. Capture HR signature image
      const hrSignatureImgBase64 = generateSignatureBase64(hrSignatureMode, hrCanvasRef.current, hrTypedName, hrSelectedFont, hrCanvasHasDrawing);
      if (!hrSignatureImgBase64) {
        throw new Error('Please draw or type the HR signature.');
      }

      // 3. Generate PDF using jsPDF
      const doc = new jsPDF({
        orientation: 'p',
        unit: 'mm',
        format: 'a4',
      });

      const formattedJoinDate = formatPakistaniDate(joiningDate);
      const formattedEndDate = formatPakistaniDate(getEndDate(joiningDate));
      const formattedLongJoinDate = formatLongDate(joiningDate);
      const fullEmployeeNameString = getFullEmployeeNameString();

      const handlePageAdd = () => {
        doc.addPage();
        doc.setTextColor(0, 0, 0);
      };

      if (docType === 'contract_letter') {
        // --- INTERNSHIP OFFER LETTER TEMPLATE ---
        doc.setFont('Helvetica', 'normal');
        doc.setFontSize(10);
        
        // Header Logo at top left
        drawPDFLogo(doc, 15, 15);
        
        // Title BELOW/AFTER Logo (centered, underlined)
        doc.setFont('Helvetica', 'bold');
        doc.setFontSize(16);
        doc.text('Internship Offer Letter', 105, 34, { align: 'center' });
        doc.setLineWidth(0.3);
        doc.line(73, 36, 137, 36);

        // Address info (Italic, on the left, below the logo)
        doc.setFont('Helvetica', 'oblique');
        doc.setFontSize(10);
        doc.text('Benchmark', 15, 42);
        doc.text('1-Montgomery Road, Lahore', 15, 47);
        doc.text(formattedLongJoinDate, 15, 52);
        
        // Recipient Name (Bold, containing S/O, D/O, W/O if selected)
        doc.setFont('Helvetica', 'bold');
        doc.text(`Mr. ${fullEmployeeNameString}`, 15, 65);
        // Project (Normal)
        doc.setFont('Helvetica', 'normal');
        doc.text(`Project: ${projectName}`, 15, 70);

        // Body Text
        const bodyText1 = `We are pleased to offer you a paid internship opportunity for a period of one (1) year, commencing on ${formattedJoinDate} and ending on ${formattedEndDate}.\n\nThis internship is designed to provide you with hands-on experience and exposure to our Architect industry, while also allowing us to assess your skills and potential for future employment.`;
        const splitBody1 = doc.splitTextToSize(bodyText1, 180);
        doc.text(splitBody1, 15, 80);

        // Terms Title (Bold & Underlined)
        doc.setFont('Helvetica', 'bold');
        doc.text('Terms of Internship', 15, 108);
        doc.line(15, 110, 47, 110);
        doc.setFont('Helvetica', 'normal');

        // Terms List
        const termsList = [
          { boldPart: '1. Duration: ', normalPart: `The internship will commence on ${formattedJoinDate} and will continue for a period of one (1) year, unless terminated earlier by either party with written notice.` },
          { boldPart: '2. Stipend: ', normalPart: `You will receive a monthly stipend of Rupees ${stipend}.` },
          { boldPart: '3. Responsibilities: ', normalPart: `Your responsibilities will include, but not be limited to:` }
        ];

        let yOffset = 116;
        termsList.forEach((term) => {
          doc.setFont('Helvetica', 'bold');
          doc.text(term.boldPart, 15, yOffset);
          const boldWidth = doc.getTextWidth(term.boldPart);
          
          doc.setFont('Helvetica', 'normal');
          const remainingWidth = 180 - boldWidth;
          const splitRemaining = doc.splitTextToSize(term.normalPart, remainingWidth);
          doc.text(splitRemaining, 15 + boldWidth, yOffset);
          
          yOffset += (splitRemaining.length * 5) + 1;
        });

        // Bullet items under Responsibilities
        const bulletItems = [
          `Assist in Photos Enhancement and Floor Plan Department with specific tasks/projects`,
          `Learn and gain experience in the technical field.`,
          `Contribute to team and department goals.`
        ];

        bulletItems.forEach((bullet) => {
          doc.setFillColor(0, 0, 0);
          doc.circle(22.5, yOffset - 1, 0.7, 'F');
          doc.setFont('Helvetica', 'normal');
          const splitBullet = doc.splitTextToSize(bullet, 170);
          doc.text(splitBullet, 26, yOffset);
          yOffset += (splitBullet.length * 5) + 1;
        });

        yOffset += 1;

        // More Terms
        const moreTerms = [
          { boldPart: '4. Evaluation and Employment: ', normalPart: `At the end of the internship period, the company will evaluate your performance and may offer you permanent employment opportunity, subject to business needs and your performance.` },
          { boldPart: '5. Termination / Resignation:\n', normalPart: `During the internship period (up to one year), the intern must provide one (1) month's prior written notice to resign. If the intern leaves without notice or prior approval, including on an urgent basis, the Company reserves the right to hold the stipend/salary for that month. The Company may terminate the internship without notice in case of irregular attendance, misconduct, insubordination, or any activity against the Company's interests.` }
        ];

        moreTerms.forEach((term) => {
          if (yOffset > 270) {
            handlePageAdd();
            yOffset = 20;
          }

          doc.setFont('Helvetica', 'bold');
          if (term.boldPart.includes('\n')) {
            doc.text('5. Termination / Resignation:', 15, yOffset);
            yOffset += 5;
            doc.setFont('Helvetica', 'normal');
            const splitNormal = doc.splitTextToSize(term.normalPart, 180);
            doc.text(splitNormal, 15, yOffset);
            yOffset += (splitNormal.length * 5) + 3;
          } else {
            doc.text(term.boldPart, 15, yOffset);
            const boldWidth = doc.getTextWidth(term.boldPart);
            doc.setFont('Helvetica', 'normal');
            const remainingWidth = 180 - boldWidth;
            const splitRemaining = doc.splitTextToSize(term.normalPart, remainingWidth);
            doc.text(splitRemaining, 15 + boldWidth, yOffset);
            yOffset += (splitRemaining.length * 5) + 3;
          }
        });

        // Obligations Title (Bold)
        if (yOffset > 265) {
          handlePageAdd();
          yOffset = 20;
        }
        doc.setFont('Helvetica', 'bold');
        doc.text('Obligations', 15, yOffset);
        doc.setFont('Helvetica', 'normal');
        yOffset += 6;

        const obligationsText = `During the internship, you will be expected to:
1. Maintain confidentiality of company information and intellectual property.
2. Adhere to company policies and procedures.
3. Work nine hours per day, as scheduled by your managers.

In case repeated mistakes are observed and sufficient improvement is not shown despite guidance and verbal warnings, the Company may, at its discretion, impose a reasonable fine. Additionally, taking off on a gazette holiday without prior permission may result in disciplinary action, which may include a fine and/or termination.`;

        const splitObligations = doc.splitTextToSize(obligationsText, 180);
        doc.text(splitObligations, 15, yOffset);
        yOffset += (splitObligations.length * 5) + 4;

        // Signatures page breaking check
        if (yOffset > 240) {
          handlePageAdd();
          yOffset = 20;
        }

        doc.setFont('Helvetica', 'bold');
        doc.text('Acceptance', 15, yOffset);
        doc.setFont('Helvetica', 'normal');
        yOffset += 6;

        const acceptanceText = `To confirm your acceptance of this internship offer, please sign and return one copy of this letter. We look forward to having you join our team!\n\nSincerely,\nAli Shan\nTitle: Human Resource Department`;
        const splitAcceptance = doc.splitTextToSize(acceptanceText, 180);
        doc.text(splitAcceptance, 15, yOffset);
        yOffset += (splitAcceptance.length * 5) + 10;

        // Acceptance Form Box
        doc.rect(12, yOffset, 186, 38);
        doc.setFont('Helvetica', 'bold');
        doc.text('Acceptance Form', 15, yOffset + 6);
        doc.setFont('Helvetica', 'normal');
        doc.text(`I, ${name}, accept the internship offer outlined above.`, 15, yOffset + 13);
        
        // Add signatures inside box
        doc.addImage(signatureImgBase64, 'PNG', 15, yOffset + 16, 45, 12);
        doc.text('______________________', 15, yOffset + 28);
        doc.text('Signature (Employee)', 15, yOffset + 32);

        // Render HR Signature on the right side of the box
        doc.addImage(hrSignatureImgBase64, 'PNG', 120, yOffset + 16, 45, 12);
        doc.text('______________________', 120, yOffset + 28);
        doc.text(`Date & HR Stamp / Sign`, 120, yOffset + 32);

      } else {
        // --- NON-DISCLOSURE AGREEMENT (NDA) TEMPLATE ---
        doc.setTextColor(0, 0, 0); // Black Text

        // Header Logo
        drawPDFLogo(doc, 15, 15);

        // Title
        doc.setFont('Helvetica', 'bold');
        doc.setFontSize(15);
        doc.text('NON-DISCLOSURE AGREEMENT (NDA)', 15, 33);
        
        doc.setFontSize(10);
        doc.setFont('Helvetica', 'normal');
        doc.text('This Non-Disclosure Agreement ("Agreement") is entered into between BenchMark ("Company")', 15, 40);
        doc.text(`and the undersigned individual ("Recipient/Employee") on the date of signing.`, 15, 45);

        // Draw horizontal line below subtitle (in gray)
        doc.setDrawColor(120, 120, 120);
        doc.setLineWidth(0.4);
        doc.line(15, 49, 195, 49);

        const ndaSections = [
          {
            title: '1. Purpose',
            text: 'The purpose of this Agreement is to protect all confidential, proprietary, and sensitive information of BenchMark and its clients that may be disclosed to the Recipient during the course of employment, contract, or professional engagement.'
          },
          {
            title: '2. Definition of Confidential Information',
            text: '"Confidential Information" includes, but is not limited to:\n- Client data, records, contacts, and project details\n- Technical, operational, financial, and business information\n- Processes, workflows, reports, documents, and internal communications\n- Any information received through systems, emails, applications, or verbal communication'
          },
          {
            title: '3. Obligation of Confidentiality',
            text: 'The Recipient agrees to:\n- Maintain strict confidentiality of all Confidential Information\n- Use Confidential Information solely for official BenchMark work purposes\n- Not disclose, copy, share, or misuse Confidential Information without prior written authorization'
          },
          {
            title: '4. Client Protection & Non-Solicitation',
            text: 'The Recipient shall not, during or after association with BenchMark:\n- Directly or indirectly approach, solicit, or provide independent or third-party services to any BenchMark client\n- Use BenchMark’s client information for personal benefit or external business\n\nAny violation will be treated as a serious breach and may result in legal action.'
          },
          {
            title: '5. Data & System Security',
            text: 'The Recipient agrees to:\n- Follow all company policies related to data protection and system access\n- Immediately report any data breach, loss, or unauthorized access\n- Return all company data, documents, and access credentials upon termination or resignation'
          },
          {
            title: '6. Duration of Confidentiality',
            text: 'The obligations under this Agreement shall remain effective during the Recipient’s association with BenchMark and continue indefinitely after termination or resignation.'
          },
          {
            title: '7. Ownership of Information',
            text: 'All confidential Information remains the exclusive property of BenchMark and/or its clients. No rights or licenses are granted under this Agreement.'
          },
          {
            title: '8. Breach & Legal Remedies',
            text: 'Any breach of this Agreement may result in disciplinary action, termination, and legal proceedings under applicable laws, including claims for damages and injunctive relief.'
          },
          {
            title: '9. Governing Law',
            text: 'This Agreement shall be governed and interpreted in accordance with the laws of Pakistan.'
          },
          {
            title: '10. Acceptance',
            text: 'By signing below, the Recipient acknowledges that they have read, understood, and agree to abide by the terms of this NDA.'
          }
        ];

        let yOffset = 56;
        ndaSections.forEach((section) => {
          // Check page break before printing heading
          if (yOffset > 270) {
            handlePageAdd();
            yOffset = 20;
          }

          doc.setFont('Helvetica', 'bold');
          doc.text(section.title, 15, yOffset);
          doc.setFont('Helvetica', 'normal');
          
          yOffset += 5;

          // Split lines by newline to parse bullet points cleanly
          const paragraphLines = section.text.split('\n');
          paragraphLines.forEach((line) => {
            const trimmed = line.trim();
            if (yOffset > 275) {
              handlePageAdd();
              yOffset = 20;
            }

            if (trimmed.startsWith('-') || trimmed.startsWith('●') || trimmed.startsWith('*')) {
              // Draw a clean vector bullet point dot in black
              doc.setFillColor(0, 0, 0);
              doc.circle(18.5, yOffset - 1, 0.7, 'F');
              
              // Print bullet text slightly offset
              const bulletText = trimmed.substring(1).trim();
              const splitLines = doc.splitTextToSize(bulletText, 172);
              doc.text(splitLines, 22, yOffset);
              yOffset += (splitLines.length * 5);
            } else {
              // Normal text line
              const splitLines = doc.splitTextToSize(line, 180);
              doc.text(splitLines, 15, yOffset);
              yOffset += (splitLines.length * 5);
            }
            yOffset += 1.5;
          });

          yOffset += 2; // Spacing between sections
        });

        // Signatures Area
        yOffset += 3;
        if (yOffset > 230) {
          handlePageAdd();
          yOffset = 20;
        }

        // Two Column Signature Table
        doc.setFont('Helvetica', 'bold');
        doc.text('For Benchmark', 15, yOffset);
        doc.text('Recipient / Employee', 110, yOffset);
        doc.setFont('Helvetica', 'normal');

        doc.text(`Authorized Signatory: ${hrName}`, 15, yOffset + 8);
        doc.text('Designation: HR Department', 15, yOffset + 14);
        
        // Render HR Signature on the left side (shifted right to sit directly over the underline)
        doc.addImage(hrSignatureImgBase64, 'PNG', 65, yOffset + 17, 45, 12);
        doc.text('Signature & Company Stamp: __________________', 15, yOffset + 30);
        doc.text(`Date: ${formattedJoinDate}`, 15, yOffset + 36);

        doc.text(`Full Name: ${fullEmployeeNameString}`, 110, yOffset + 8);
        doc.text(`CNIC: ${cnic || '—'}`, 110, yOffset + 14);
        
        // Render Employee Signature on the right side (shifted right to sit directly over the underline)
        doc.addImage(signatureImgBase64, 'PNG', 127, yOffset + 17, 45, 12);
        doc.text('Signature: __________________', 110, yOffset + 30);
        doc.text(`Date: ${formattedJoinDate}`, 110, yOffset + 36);
      }

      // Convert PDF to Blob
      const pdfBlob = doc.output('blob');
      const filename = `${name.replace(/\s+/g, '_')}_${docType === 'nda' ? 'NDA' : 'Offer_Letter'}.pdf`;
      const pdfFile = new File([pdfBlob], filename, { type: 'application/pdf' });

      // 3. Upload Document using FormData
      const formData = new FormData();
      formData.append('documents[0][document_type]', docType);
      formData.append('documents[0][file]', pdfFile, filename);

      await hrService.uploadDocuments(Number(userId), formData);
      if (window.opener) {
        try {
          window.opener.location.reload();
        } catch (e) {
          console.error('Failed to reload parent:', e);
        }
        window.close();
      } else {
        navigate(`/hr-panel`);
      }

    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to generate or upload PDF.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-teal-600 border-t-transparent" />
      </div>
    );
  }

  const isNda = docType === 'nda';
  const fullEmployeeNameString = getFullEmployeeNameString();

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      {/* Import beautiful handwriting cursive fonts from Google Fonts */}
      <link href="https://fonts.googleapis.com/css2?family=Alex+Brush&family=Dancing+Script&family=Great+Vibes&family=Herr+Von+Muellerhoff&family=Parisienne&family=Playball&display=swap" rel="stylesheet" />

      {/* Back button */}
      <button
        onClick={handleCancelOrBack}
        className="mb-4 flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to HR Dashboard
      </button>

      <PageHeader
        title={`Generate ${isNda ? 'NDA' : 'Offer Letter'}`}
        subtitle={`Dynamically generate, sign, and auto-upload document for ${name}`}
      />

      {error && (
        <div className="mb-6 flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left Side: Form Controls & Signature */}
        <div className="space-y-6">
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-500">Document Settings</h3>
            
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="sm:col-span-2">
                  <label className="block text-sm">
                    <span className="mb-1 block font-medium text-slate-700">Employee Name</span>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-teal-500 focus:bg-white focus:outline-none"
                    />
                  </label>
                </div>
                <div>
                  <label className="block text-sm">
                    <span className="mb-1 block font-medium text-slate-700">Relationship</span>
                    <select
                      value={relationshipType}
                      onChange={(e) => setRelationshipType(e.target.value as any)}
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-teal-500 focus:bg-white focus:outline-none"
                    >
                      <option value="">None</option>
                      <option value="S/O">S/O (Son of)</option>
                      <option value="D/O">D/O (Daughter of)</option>
                      <option value="W/O">W/O (Wife of)</option>
                    </select>
                  </label>
                </div>
              </div>

              {relationshipType && (
                <label className="block text-sm">
                  <span className="mb-1 block font-medium text-slate-700">Relative / Guardian Name</span>
                  <input
                    type="text"
                    value={relativeName}
                    onChange={(e) => setRelativeName(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-teal-500 focus:bg-white focus:outline-none"
                    placeholder="e.g. Guardian / Husband Name"
                  />
                </label>
              )}

              {isNda && (
                <label className="block text-sm">
                  <span className="mb-1 block font-medium text-slate-700">CNIC Number</span>
                  <input
                    type="text"
                    placeholder="e.g. 35202-1234567-8"
                    value={cnic}
                    onChange={(e) => setCnic(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-teal-500 focus:bg-white focus:outline-none"
                  />
                </label>
              )}

              <div className="grid gap-4 md:grid-cols-2">
                <label className="block text-sm">
                  <span className="mb-1 block font-medium text-slate-700">Joining Date</span>
                  <input
                    type="date"
                    value={joiningDate}
                    onChange={(e) => setJoiningDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-teal-500 focus:bg-white focus:outline-none"
                  />
                </label>

                {!isNda && (
                  <label className="block text-sm">
                    <span className="mb-1 block font-medium text-slate-700">Monthly Stipend (PKR)</span>
                    <input
                      type="number"
                      value={stipend}
                      onChange={(e) => setStipend(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-teal-500 focus:bg-white focus:outline-none"
                    />
                  </label>
                )}
              </div>

              {!isNda && (
                <label className="block text-sm">
                  <span className="mb-1 block font-medium text-slate-700">Project Name</span>
                  <input
                    type="text"
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-teal-500 focus:bg-white focus:outline-none"
                  />
                </label>
              )}
            </div>
          </div>

          {/* Employee Signature Panel */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500">Employee Signature</h3>
              <div className="flex gap-2 rounded-lg bg-slate-100 p-1">
                <button
                  onClick={() => setSignatureMode('draw')}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
                    signatureMode === 'draw' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  <Brush className="h-3.5 w-3.5" />
                  Draw
                </button>
                <button
                  onClick={() => setSignatureMode('type')}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
                    signatureMode === 'type' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  <Edit3 className="h-3.5 w-3.5" />
                  Type
                </button>
              </div>
            </div>

            {signatureMode === 'draw' ? (
              <div className="space-y-3">
                <div className="relative overflow-hidden rounded-lg border border-dashed border-slate-300 bg-slate-50">
                  <canvas
                    ref={canvasRef}
                    width={500}
                    height={120}
                    onMouseDown={startDrawing}
                    onMouseMove={draw}
                    onMouseUp={stopDrawing}
                    onMouseLeave={stopDrawing}
                    onTouchStart={startDrawing}
                    onTouchMove={draw}
                    onTouchEnd={stopDrawing}
                    className="h-[120px] w-full cursor-crosshair bg-slate-50 touch-none"
                  />
                  {!canvasHasDrawing && (
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-slate-400">
                      <Brush className="mb-1 h-5 w-5 opacity-40 animate-pulse" />
                      <span className="text-xs">Draw Employee Signature</span>
                    </div>
                  )}
                </div>
                <div className="flex justify-end">
                  <button
                    onClick={clearCanvas}
                    className="flex items-center gap-1 rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-200 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Clear Draw
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <label className="block text-sm">
                  <span className="mb-1 block font-medium text-slate-600 font-semibold">Type Name</span>
                  <input
                    type="text"
                    value={typedName}
                    onChange={(e) => setTypedName(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-teal-500 focus:bg-white focus:outline-none"
                  />
                </label>
                
                <div>
                  <span className="mb-2 block text-xs font-medium text-slate-500">CHOOSE FONT STYLE</span>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {(['GreatVibes', 'AlexBrush', 'Playball', 'DancingScript', 'Parisienne', 'HerrVonMuellerhoff'] as const).map((font) => (
                      <button
                        key={font}
                        onClick={() => setSelectedFont(font)}
                        className={`rounded-lg border px-3 py-3 text-center transition-all ${
                          selectedFont === font
                            ? 'border-teal-500 bg-teal-50/50 ring-1 ring-teal-500'
                            : 'border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <span className={`${fontStyles[font]} text-slate-800`}>
                          {typedName || 'Signature'}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* HR Signature Panel */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500">HR / Authorized Signatory</h3>
                <input
                  type="text"
                  value={hrName}
                  onChange={(e) => {
                    setHrName(e.target.value);
                    setHrTypedName(e.target.value);
                  }}
                  placeholder="HR Signatory Name"
                  className="mt-1 rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs focus:bg-white focus:outline-none"
                />
              </div>
              <div className="flex gap-2 rounded-lg bg-slate-100 p-1 self-start">
                <button
                  onClick={() => setHrSignatureMode('draw')}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
                    hrSignatureMode === 'draw' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  <Brush className="h-3.5 w-3.5" />
                  Draw
                </button>
                <button
                  onClick={() => setHrSignatureMode('type')}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
                    hrSignatureMode === 'type' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  <Edit3 className="h-3.5 w-3.5" />
                  Type
                </button>
              </div>
            </div>

            {hrSignatureMode === 'draw' ? (
              <div className="space-y-3">
                <div className="relative overflow-hidden rounded-lg border border-dashed border-slate-300 bg-slate-50">
                  <canvas
                    ref={hrCanvasRef}
                    width={500}
                    height={120}
                    onMouseDown={startHrDrawing}
                    onMouseMove={drawHr}
                    onMouseUp={stopHrDrawing}
                    onMouseLeave={stopHrDrawing}
                    onTouchStart={startHrDrawing}
                    onTouchMove={drawHr}
                    onTouchEnd={stopHrDrawing}
                    className="h-[120px] w-full cursor-crosshair bg-slate-50 touch-none"
                  />
                  {!hrCanvasHasDrawing && (
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-slate-400">
                      <Brush className="mb-1 h-5 w-5 opacity-40 animate-pulse" />
                      <span className="text-xs">Draw HR Signature</span>
                    </div>
                  )}
                </div>
                <div className="flex justify-end">
                  <button
                    onClick={clearHrCanvas}
                    className="flex items-center gap-1 rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-200 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Clear Draw
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <label className="block text-sm">
                  <span className="mb-1 block font-medium text-slate-600 font-semibold">HR Typed Signature</span>
                  <input
                    type="text"
                    value={hrTypedName}
                    onChange={(e) => setHrTypedName(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-teal-500 focus:bg-white focus:outline-none"
                  />
                </label>
                
                <div>
                  <span className="mb-2 block text-xs font-medium text-slate-500">CHOOSE FONT STYLE</span>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {(['GreatVibes', 'AlexBrush', 'Playball', 'DancingScript', 'Parisienne', 'HerrVonMuellerhoff'] as const).map((font) => (
                      <button
                        key={font}
                        onClick={() => setHrSelectedFont(font)}
                        className={`rounded-lg border px-3 py-3 text-center transition-all ${
                          hrSelectedFont === font
                            ? 'border-teal-500 bg-teal-50/50 ring-1 ring-teal-500'
                            : 'border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <span className={`${fontStyles[font]} text-slate-800`}>
                          {hrTypedName || 'HR Signature'}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="secondary"
              onClick={handleCancelOrBack}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              onClick={handleGenerateAndUpload}
              loading={submitting}
              icon={<Sparkles className="h-4 w-4" />}
              className="flex-[2] bg-teal-600 hover:bg-teal-700 focus-visible:ring-teal-500/30 text-white"
            >
              Generate & Upload PDF
            </Button>
          </div>
        </div>

        {/* Right Side: Live HTML Preview */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm flex flex-col h-[750px] overflow-hidden">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1.5 shrink-0">
            <FileText className="h-4 w-4 text-teal-600" />
            Live Preview
          </h3>
          <div className="flex-1 overflow-y-auto border border-slate-100 rounded-lg bg-slate-50 p-6 font-serif text-sm leading-relaxed text-slate-800 select-none">
            {isNda ? (
              // NDA PREVIEW
              <div className="space-y-4 bg-white text-slate-900 p-6 shadow-sm border border-slate-200 rounded min-h-full">
                <div className="flex items-center justify-between border-b border-slate-200 pb-2 mb-2">
                  <BenchmarkLogo size="sm" showText={true} />
                </div>
                <h4 className="text-center text-sm font-bold uppercase tracking-wide">
                  Non-Disclosure Agreement (NDA)
                </h4>
                <p className="text-xs text-slate-700">
                  This Non-Disclosure Agreement ("Agreement") is entered into between <strong>BenchMark</strong> ("Company") and the undersigned individual <strong>{fullEmployeeNameString || '[Employee Name]'}</strong> ("Recipient/Employee") on the date of signing.
                </p>

                {/* dividing line */}
                <hr className="border-slate-300" />

                <div className="space-y-3">
                  <div>
                    <h5 className="font-bold text-slate-900 text-xs">1. Purpose</h5>
                    <p className="text-xs text-slate-600 mt-0.5">
                      The purpose of this Agreement is to protect all confidential, proprietary, and sensitive information of BenchMark and its clients that may be disclosed to the Recipient during the course of employment, contract, or professional engagement.
                    </p>
                  </div>

                  <div>
                    <h5 className="font-bold text-slate-900 text-xs">2. Definition of Confidential Information</h5>
                    <p className="text-xs text-slate-600 mt-0.5 whitespace-pre-wrap leading-relaxed">
                      "Confidential Information" includes, but is not limited to:
                      {"\n"}● Client data, records, contacts, and project details
                      {"\n"}● Technical, operational, financial, and business information
                      {"\n"}● Processes, workflows, reports, documents, and internal communications
                      {"\n"}● Any information received through systems, emails, applications, or verbal communication
                    </p>
                  </div>

                  <div>
                    <h5 className="font-bold text-slate-900 text-xs">3. Obligation of Confidentiality</h5>
                    <p className="text-xs text-slate-600 mt-0.5 whitespace-pre-wrap leading-relaxed">
                      The Recipient agrees to:
                      {"\n"}● Maintain strict confidentiality of all Confidential Information
                      {"\n"}● Use Confidential Information solely for official BenchMark work purposes
                      {"\n"}● Not disclose, copy, share, or misuse Confidential Information without prior written authorization
                    </p>
                  </div>

                  <div>
                    <h5 className="font-bold text-slate-900 text-xs">4. Client Protection & Non-Solicitation</h5>
                    <p className="text-xs text-slate-600 mt-0.5 whitespace-pre-wrap leading-relaxed">
                      The Recipient shall not, during or after association with BenchMark:
                      {"\n"}● Directly or indirectly approach, solicit, or provide independent or third-party services to any BenchMark client
                      {"\n"}● Use BenchMark’s client information for personal benefit or external business
                      {"\n\n"}Any violation will be treated as a serious breach and may result in legal action.
                    </p>
                  </div>

                  <div>
                    <h5 className="font-bold text-slate-900 text-xs">5. Data & System Security</h5>
                    <p className="text-xs text-slate-600 mt-0.5 whitespace-pre-wrap leading-relaxed">
                      The Recipient agrees to:
                      {"\n"}● Follow all company policies related to data protection and system access
                      {"\n"}● Immediately report any data breach, loss, or unauthorized access
                      {"\n"}● Return all company data, documents, and access credentials upon termination or resignation
                    </p>
                  </div>

                  <div>
                    <h5 className="font-bold text-slate-900 text-xs">6. Duration of Confidentiality</h5>
                    <p className="text-xs text-slate-600 mt-0.5">
                      The obligations under this Agreement shall remain effective during the Recipient’s association with BenchMark and continue indefinitely after termination or resignation.
                    </p>
                  </div>

                  <div>
                    <h5 className="font-bold text-slate-900 text-xs">7. Ownership of Information</h5>
                    <p className="text-xs text-slate-600 mt-0.5">
                      All confidential Information remains the exclusive property of BenchMark and/or its clients. No rights or licenses are granted under this Agreement.
                    </p>
                  </div>

                  <div>
                    <h5 className="font-bold text-slate-900 text-xs">8. Breach & Legal Remedies</h5>
                    <p className="text-xs text-slate-600 mt-0.5">
                      Any breach of this Agreement may result in disciplinary action, termination, and legal proceedings under applicable laws, including claims for damages and injunctive relief.
                    </p>
                  </div>

                  <div>
                    <h5 className="font-bold text-slate-900 text-xs">9. Governing Law</h5>
                    <p className="text-xs text-slate-600 mt-0.5">
                      This Agreement shall be governed and interpreted in accordance with the laws of Pakistan.
                    </p>
                  </div>

                  <div>
                    <h5 className="font-bold text-slate-900 text-xs">10. Acceptance</h5>
                    <p className="text-xs text-slate-600 mt-0.5">
                      By signing below, the Recipient acknowledges that they have read, understood, and agree to abide by the terms of this NDA.
                    </p>
                  </div>
                </div>

                <div className="pt-6 border-t border-slate-200 grid grid-cols-2 gap-4 text-xs">
                  <div className="space-y-1">
                    <p className="font-bold text-slate-900 text-sm">For Benchmark</p>
                    <p className="mt-2 text-slate-600">Authorized Signatory: {hrName}</p>
                    <p className="text-slate-600">Designation: HR Department</p>
                    <div className="h-10 flex items-center border border-dashed border-slate-200 bg-slate-50 px-2 rounded mt-1 overflow-hidden">
                      {hrSignatureMode === 'draw' && hrCanvasHasDrawing && hrCanvasRef.current ? (
                        <img src={hrCanvasRef.current.toDataURL()} className="max-h-8 object-contain" alt="HR Sign" />
                      ) : hrSignatureMode === 'type' && hrTypedName ? (
                        <span className={`${fontStyles[hrSelectedFont]} text-slate-900`}>{hrTypedName}</span>
                      ) : (
                        <span className="text-[10px] text-slate-400">HR Signature placeholder</span>
                      )}
                    </div>
                    <p className="mt-1 text-slate-600">Signature & Stamp: __________________</p>
                    <p className="text-slate-600">Date: {formatPakistaniDate(joiningDate) || '[Date]'}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="font-bold text-slate-900 text-sm">Recipient / Employee</p>
                    <p className="mt-2 text-slate-600">Full Name: {name || '[Name]'}</p>
                    <p className="text-slate-600">CNIC: {cnic || '[CNIC]'}</p>
                    <div className="h-10 flex items-center border border-dashed border-slate-200 bg-slate-50 px-2 rounded mt-1 overflow-hidden">
                      {signatureMode === 'draw' && canvasHasDrawing && canvasRef.current ? (
                        <img src={canvasRef.current.toDataURL()} className="max-h-8 object-contain" alt="Sign" />
                      ) : signatureMode === 'type' && typedName ? (
                        <span className={`${fontStyles[selectedFont]} text-slate-900`}>{typedName}</span>
                      ) : (
                        <span className="text-[10px] text-slate-400">Signature will appear here</span>
                      )}
                    </div>
                    <p className="mt-1 text-slate-600">Signature: __________________</p>
                    <p className="text-slate-600">Date: {formatPakistaniDate(joiningDate) || '[Date]'}</p>
                  </div>
                </div>
              </div>
            ) : (
              // OFFER LETTER PREVIEW
              <div className="space-y-4 bg-white p-6 shadow-sm border border-slate-200 rounded min-h-full">
                <div className="flex items-center justify-between border-b pb-2 mb-2">
                  <BenchmarkLogo size="sm" showText={true} />
                </div>
                <div className="text-right">
                  <span className="text-base font-bold uppercase tracking-wide border-b-2 border-slate-900 pb-0.5">
                    Internship Offer Letter
                  </span>
                </div>

                <div className="text-xs space-y-1 pt-2 italic text-slate-600">
                  <p className="font-semibold not-italic text-slate-800">Benchmark</p>
                  <p>1-Montgomery Road, Lahore</p>
                  <p>Date: {formatLongDate(joiningDate) || '[Date]'}</p>
                </div>

                <div className="pt-2 text-xs">
                  <p className="font-bold text-slate-900 text-sm">Mr. {fullEmployeeNameString || '[Employee Name]'}</p>
                  <p className="text-slate-500">Project: {projectName || '[Project Name]'}</p>
                </div>

                <p className="text-xs leading-relaxed">
                  We are pleased to offer you a paid internship opportunity for a period of one (1) year, commencing on <strong>{formatPakistaniDate(joiningDate) || '[Joining Date]'}</strong> and ending on <strong>{formatPakistaniDate(getEndDate(joiningDate)) || '[End Date]'}</strong>.
                </p>

                <div className="space-y-2">
                  <h5 className="font-bold text-slate-900 text-xs border-b border-slate-200 pb-1">Terms of Internship</h5>
                  <p className="text-xs text-slate-700">
                    <strong>1. Duration:</strong> The internship will commence on {formatPakistaniDate(joiningDate)} and will continue for a period of one (1) year, unless terminated earlier by either party with written notice.
                  </p>
                  <p className="text-xs text-slate-700">
                    <strong>2. Stipend:</strong> You will receive a monthly stipend of Rupees {stipend || '[Stipend]'}.
                  </p>
                  <p className="text-xs text-slate-700">
                    <strong>3. Responsibilities:</strong> Your responsibilities will include, but not be limited to:
                  </p>
                  <ul className="list-disc pl-5 text-xs text-slate-600 space-y-1">
                    <li>Assist in Photos Enhancement and Floor Plan Department with specific tasks/projects</li>
                    <li>Learn and gain experience in the technical field.</li>
                    <li>Contribute to team and department goals.</li>
                  </ul>
                  <p className="text-xs text-slate-700 mt-2">
                    <strong>4. Evaluation and Employment:</strong> At the end of the internship period, the company will evaluate your performance and may offer you permanent employment opportunity, subject to business needs and your performance.
                  </p>
                  <p className="text-xs text-slate-700">
                    <strong>5. Termination / Resignation:</strong>
                    {"\n"}During the internship period (up to one year), the intern must provide one (1) month’s prior written notice to resign. Leaving without notice may result in hold of stipend.
                  </p>
                </div>

                <div className="pt-4 border-t text-xs">
                  <p>Sincerely,</p>
                  <p className="font-bold">{hrName}</p>
                  <p className="text-slate-500">Human Resource Department</p>
                </div>

                <div className="mt-4 border-t pt-4 text-xs bg-slate-50 p-3 rounded border">
                  <p className="font-bold text-slate-900 mb-1">Acceptance Form</p>
                  <p className="mb-2">I, <strong>{name || '[Employee Name]'}</strong>, accept the internship offer outlined above.</p>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="h-10 flex items-center border border-dashed border-slate-200 bg-white px-2 rounded overflow-hidden">
                        {signatureMode === 'draw' && canvasHasDrawing && canvasRef.current ? (
                          <img src={canvasRef.current.toDataURL()} className="max-h-8 object-contain" alt="Sign" />
                        ) : signatureMode === 'type' && typedName ? (
                          <span className={`${fontStyles[selectedFont]} text-slate-900`}>{typedName}</span>
                        ) : (
                          <span className="text-[10px] text-slate-400">Signature placeholder</span>
                        )}
                      </div>
                      <p className="mt-1 text-[10px] text-slate-500">Signature (Employee)</p>
                    </div>
                    <div>
                      <div className="h-10 flex items-center border border-dashed border-slate-200 bg-white px-2 rounded overflow-hidden">
                        {hrSignatureMode === 'draw' && hrCanvasHasDrawing && hrCanvasRef.current ? (
                          <img src={hrCanvasRef.current.toDataURL()} className="max-h-8 object-contain" alt="HR Sign" />
                        ) : hrSignatureMode === 'type' && hrTypedName ? (
                          <span className={`${fontStyles[hrSelectedFont]} text-slate-900`}>{hrTypedName}</span>
                        ) : (
                          <span className="text-[10px] text-slate-400">HR Signature placeholder</span>
                        )}
                      </div>
                      <p className="mt-1 text-[10px] text-slate-500">HR Stamp / Sign</p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
