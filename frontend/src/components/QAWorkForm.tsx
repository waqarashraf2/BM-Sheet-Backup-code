import { useState, useEffect, useRef } from 'react';
import type { Order } from '../types';
import type { WorkItem } from '../types';
import { REJECTION_CODES } from '../types';
import { workflowService } from '../services';
import { Button, Textarea, Select } from './ui';
import { Eye, Clock, X, Flag, HelpCircle, CheckCircle2, Circle, Send, MessageSquare, History } from 'lucide-react';
import { getLatestStageArea } from '../utils/workItemArea';
import QAClientPortalUpload from './QAClientPortalUpload';
import type { ClientPortalUploadStatus } from '../services';

interface QAWorkFormProps {
  order: Order;
  onComplete: () => void;
  onClose: () => void;
}

interface OrderDetails {
  order: Order;
  supervisor_notes: string | null;
  attachments: Array<{ name: string; url: string; type: string }>;
  help_requests: any[];
  issue_flags: any[];
  current_time_seconds: number;
  timer_running: boolean;
  work_items?: WorkItem[];
}

interface ChecklistItem {
  id: string;
  label: string;
  description: string;
  category?: string;
  checked: boolean;
  status?: 'yes' | 'no' | null;
  type?: 'checkbox' | 'yes_no';
}

type ImageCountStateKey =
  | 'totalImages'
  | 'totalOutputs'
  | 'singleExposureImages'
  | 'jpegToHdr'
  | 'rawToHdrWithoutEdit'
  | 'rawToHdrWithBaseEdit'
  | 'duskImages'
  | 'objectRemovalJpegHdrLessThan45'
  | 'objectRemovalJpegHdrMoreThan45'
  | 'objectRemovalJpegHdrAdvanceDeclutter'
  | 'objectRemovalRawHdrLessThan45'
  | 'objectRemovalRawHdrMoreThan45'
  | 'objectRemovalRawHdrAdvanceDeclutter'
  | 'aerialBoundriesSingleProperty'
  | 'aerialAddingMultipleLocationPins'
  | 'aerialBoundriesMultipleProperties'
  | 'vfImages'
  | 'normalImages'
  | 'hdrImages'
  | 'editImages'
  | 'finalImages';
type ImageCountPayloadKey =
  | 'total_raw_files'
  | 'hdr_images_count'
  | 'single_images_count'
  | 'final_images_count'
  | 'edited_images_count';

interface ImageCountFieldConfig {
  stateKey: ImageCountStateKey;
  label: string;
  commentLabels: string[];
  metadataKeys: string[];
  payloadKey?: ImageCountPayloadKey;
}

const DEFAULT_CHECKLIST: ChecklistItem[] = [
  { id: 'dimensions', label: 'Dimensions & Measurements', description: 'All dimensions match source data accurately', checked: false },
  { id: 'format', label: 'File Format & Quality', description: 'Output meets required format, resolution, and quality standards', checked: false },
  { id: 'specifications', label: 'Client Specifications', description: 'Work follows all client-specific requirements and standards', checked: false },
  { id: 'corrections', label: 'Previous Corrections Applied', description: 'All corrections from previous stages have been properly addressed', checked: false },
  { id: 'labeling', label: 'Labeling & Annotations', description: 'All labels, text, and annotations are correct and properly placed', checked: false },
  { id: 'completeness', label: 'Completeness Check', description: 'No missing elements — all required items present', checked: false },
];

const PROJECT_CHECKLISTS: Record<number, ChecklistItem[]> = {
  13: [
    // 1. Template
    {
      id: 'p13_template',
      category: '1. Template',
      label: '1. Template',
      description: '• Font style, type, and size\n• Textures\n• Door and window styles\n• Dimensions (SQM / SQFT / Both)\n• Fixtures and furniture styles',
      checked: false,
      status: null,
      type: 'yes_no',
    },
    // 2. Tour Walkthrough
    {
      id: 'p13_tour_walkthrough',
      category: '2. Tour Walkthrough',
      label: '2. Tour Walkthrough',
      description: '• Ensure no areas, rooms, or elements are missing\n• Verify the overall structure matches the tour\n• Confirm walls, openings, rooms, and other structural elements are correctly represented',
      checked: false,
      status: null,
      type: 'yes_no',
    },
    // 3. Dimensions
    {
      id: 'p13_dimensions',
      category: '3. Dimensions',
      label: '3. Dimensions',
      description: '• Dimensions are present and complete\n• Measurements are accurate\n• Measurements are readable\n• Dimensions are consistent with the visualizer/tour',
      checked: false,
      status: null,
      type: 'yes_no',
    },
    // 4. Labeling
    {
      id: 'p13_labeling',
      category: '4. Labeling',
      label: '4. Labeling',
      description: '• All rooms, areas, and key elements are correctly labeled\n• Labels follow template standards\n• Correct language is used\n• No incorrect, missing, or duplicate labels',
      checked: false,
      status: null,
      type: 'yes_no',
    },
    // 5. Site Plan
    {
      id: 'p13_site_plan',
      category: '5. Site Plan',
      label: '5. Site Plan',
      description: '• Orientation and layout match Google Maps\n• Property boundaries are correctly positioned\n• Property orientation/placement is relative to the site boundary\n• Driveways, fences/gates, pools, decks, sheds, and other external elements are accurately shown',
      checked: false,
      status: null,
      type: 'yes_no',
    },
    // 6. North Arrow
    {
      id: 'p13_north_arrow',
      category: '6. North Arrow',
      label: '6. North Arrow',
      description: '• North arrow is present\n• North arrow is correctly oriented according to the site/location',
      checked: false,
      status: null,
      type: 'yes_no',
    },
    // 7. Address / Title
    {
      id: 'p13_address_title',
      category: '7. Address / Title',
      label: '7. Address / Title',
      description: '• Correct property address/title is included\n• Spelling and formatting are correct\n• Title follows template requirements',
      checked: false,
      status: null,
      type: 'yes_no',
    },
    // 8. Area
    {
      id: 'p13_area',
      category: '8. Area',
      label: '8. Area',
      description: '• Internal area\n• External area\n• Total area\n• Any other required area measurements\n• Areas are correctly calculated and displayed',
      checked: false,
      status: null,
      type: 'yes_no',
    },
    // 9. 360° Views
    {
      id: 'p13_360_views',
      category: '9. 360° Views',
      label: '9. 360° Views',
      description: '• Check all available 360° views\n• Ensure relevant areas/elements visible in the views are reflected in the plan\n• Identify any missing or inconsistent information',
      checked: false,
      status: null,
      type: 'yes_no',
    },
    // 10. Notes
    {
      id: 'p13_notes',
      category: '10. Notes',
      label: '10. Notes',
      description: '• All provided notes are accurately followed\n• Special instructions are incorporated\n• No instruction is missed or incorrectly interpreted',
      checked: false,
      status: null,
      type: 'yes_no',
    },
    // 11. Final Files / Template Requirements
    {
      id: 'p13_file_formats',
      category: '11. Final Files / Template Requirements',
      label: 'File Formats',
      description: 'File Formats',
      checked: false,
      status: null,
      type: 'yes_no',
    },
    {
      id: 'p13_naming',
      category: '11. Final Files / Template Requirements',
      label: 'Naming',
      description: 'Naming',
      checked: false,
      status: null,
      type: 'yes_no',
    },
    {
      id: 'p13_resolution',
      category: '11. Final Files / Template Requirements',
      label: 'Resolution',
      description: 'Resolution: crisp and clear (no pixelation)',
      checked: false,
      status: null,
      type: 'yes_no',
    },
    {
      id: 'p13_line_weights',
      category: '11. Final Files / Template Requirements',
      label: 'Line Weights Hierarchy',
      description: 'Line weights hierarchy: internal walls, external walls fixtures, boundary lines are readable and consistent with the template',
      checked: false,
      status: null,
      type: 'yes_no',
    },
    {
      id: 'p13_overlaps_clashes',
      category: '11. Final Files / Template Requirements',
      label: 'No Overlaps / Clashes',
      description: 'No overlaps/clashes: dimensions not overlapping labels/fixtures, text not sitting on busy textures.',
      checked: false,
      status: null,
      type: 'yes_no',
    },
  ],
  15: [
    // 1. Template
    { id: 'p15_template_verify', category: '1. Template', label: 'Template Adherence', description: 'Verify that the drawing strictly follows the updated template, including:', checked: false },
    { id: 'p15_template_font', category: '1. Template', label: 'Label Font Style', description: 'Label Font style (Type and Size)', checked: false },
    { id: 'p15_template_textures', category: '1. Template', label: 'Textures & Colors', description: 'Textures and Colors used in template', checked: false },
    { id: 'p15_template_openings', category: '1. Template', label: 'Door & Window Styles', description: 'Door and window styles', checked: false },
    { id: 'p15_template_fixtures', category: '1. Template', label: 'Fixtures & Furniture Styles', description: 'Fixtures and furniture styles', checked: false },
    { id: 'p15_template_lineweight', category: '1. Template', label: 'Stroke & Lineweight', description: 'Stroke & lineweight', checked: false },

    // 2. Video Walkthrough / Meshes
    { id: 'p15_video_meshes', category: '2. Video Walkthrough / Meshes', label: 'Walkthrough & Structure Meshes', description: 'Perform a complete walkthrough of the tour to ensure no areas, rooms, or elements are missing. Also verify that the structure matches the meshes.', checked: false },

    // 3. Dimensions
    { id: 'p15_dim_accuracy', category: '3. Dimensions', label: 'Dimensions Accuracy & Consistency', description: 'Confirm that all dimensions are present, accurate, readable, and consistent with the visualizer.', checked: false },
    { id: 'p15_dim_units', category: '3. Dimensions', label: 'Dimension Units & Decimal Values', description: 'Dimension (SQM, SQFT, BOTH also Decimal value)', checked: false },
    { id: 'p15_dim_kitchen_bath', category: '3. Dimensions', label: 'Kitchen & Bath/Ldry Dimensions', description: 'Kitchen & Bath/Ldry Dimensions', checked: false },

    // 4. Labeling
    { id: 'p15_label_standards', category: '4. Labeling', label: 'Rooms & Key Elements Labeling', description: 'Ensure all rooms, areas, and key elements are correctly labeled according to template standards.', checked: false },
    { id: 'p15_label_language', category: '4. Labeling', label: 'Correct Language', description: 'Correct Language', checked: false },
    { id: 'p15_label_template_names', category: '4. Labeling', label: 'Template Labels', description: 'Label according to template (Linen, Wir, Robe & Clo)', checked: false },
    { id: 'p15_label_font_style', category: '4. Labeling', label: 'Label Font Style (Type and Size)', description: 'Label Font style (Type and Size)', checked: false },

    // 5. Site Plan
    { id: 'p15_site_google_maps', category: '5. Site Plan', label: 'Google Maps Match & Orientation', description: 'Verify that the site plan matches the Google Maps location in terms of orientation and layout.', checked: false },
    { id: 'p15_site_boundary', category: '5. Site Plan', label: 'Boundary Lines & Property Placement', description: 'Verify boundary lines match and property orientation/palcement is relative to the site boundary', checked: false },
    { id: 'p15_site_external', category: '5. Site Plan', label: 'External Elements Verification', description: 'Verify external elements are correct: driveway, fences/gates, pools, decks, sheds and other relevant elements are shown accurately.', checked: false },
    { id: 'p15_site_labels_fp', category: '5. Site Plan', label: 'SP Labels vs FP', description: 'Check SP all labels according to FP. Like (Patio, Porch, Carport, etc)', checked: false },

    // 6. North & Disclaimer
    { id: 'p15_north_arrow', category: '6. North & Disclaimer', label: 'North Arrow Orientation', description: 'Confirm that the North arrow is present and correctly oriented.', checked: false },
    { id: 'p15_disclaimer', category: '6. North & Disclaimer', label: 'North , Disclaimer', description: 'North , Disclaimer', checked: false },

    // 7. Address/Title
    { id: 'p15_address_correct', category: '7. Address/Title', label: 'Property Address / Title', description: 'Ensure the correct Property address or requested title has been added', checked: false },
    { id: 'p15_address_style', category: '7. Address/Title', label: 'Address & Address Style', description: 'Check Address & Address style', checked: false },

    // 8. Area
    { id: 'p15_area_calc', category: '8. Area', label: 'Area Measurements Calculation', description: 'Verify that all area measurements (internal, external, total, or as required) are correctly calculated and displayed.', checked: false },
    { id: 'p15_area_style', category: '8. Area', label: 'Area Style (Decimal Value)', description: 'Area Style (Decimal Value)', checked: false },

    // 9. Data Sheet
    { id: 'p15_datasheet', category: '9. Data Sheet', label: 'Data Sheet Details', description: 'Ensure all details are accurately included in the data sheet, such as climate control, room names, floor names, kitchen accessories, ceiling height, and floor type.', checked: false },

    // 10. Notes
    { id: 'p15_notes_follow', category: '10. Notes', label: 'Plan Notes Compliance', description: 'Ensure all provided notes are accurately followed in the plan.', checked: false },
    { id: 'p15_notes_attachments', category: '10. Notes', label: 'Notes & Attachments', description: 'Check notes & Attachments', checked: false },

    // 11. Final Files (Template Requirements)
    { id: 'p15_final_deliverables', category: '11. Final Files (Template Requirements)', label: 'Final Deliverables Organization', description: 'Confirm that all final deliverables are exported and organized according to template requirements', checked: false },
    { id: 'p15_file_formats', category: '11. Final Files (Template Requirements)', label: 'File Formats', description: 'File Formats', checked: false },
    { id: 'p15_file_naming', category: '11. Final Files (Template Requirements)', label: 'Naming Standards', description: 'Naming', checked: false },
    { id: 'p15_file_resolution', category: '11. Final Files (Template Requirements)', label: 'Resolution (Crisp & Clear)', description: 'Resolution: crisp and clear (no pixelation)', checked: false },
    { id: 'p15_svg_export', category: '11. Final Files (Template Requirements)', label: 'SVG Export Settings', description: 'Svg Exported through updated setting values', checked: false },
    { id: 'p15_final_quality', category: '11. Final Files (Template Requirements)', label: 'Top-Level Quality Check', description: 'Final File – Top-Level Quality Check', checked: false },
  ],
};

const getInitialChecklist = (projectId?: number): ChecklistItem[] => {
  const pId = Number(projectId || 0);
  const list = PROJECT_CHECKLISTS[pId] ?? DEFAULT_CHECKLIST;
  return list.map(c => ({ ...c }));
};

const DEFAULT_IMAGE_COUNT_FIELDS: ImageCountFieldConfig[] = [
  { stateKey: 'totalImages', label: 'Total', commentLabels: ['Total Raw Files', 'Total Images', 'Images', 'Total'], metadataKeys: ['total_raw_files', 'images', 'total_images', 'totalImages'] },
  { stateKey: 'normalImages', label: 'Normal', commentLabels: ['Single Images', 'Normal Images', 'Normal'], metadataKeys: ['single_images_count', 'normal_images', 'normalImages', 'normal_final_images', 'normalFinalImages'] },
  { stateKey: 'hdrImages', label: 'HDR', commentLabels: ['HDR Images', 'HDR'], metadataKeys: ['hdr_images_count', 'hdr_images', 'hdrImages'] },
  { stateKey: 'editImages', label: 'Edited', commentLabels: ['Edited Images', 'Edit Images', 'Edited', 'Edit'], metadataKeys: ['edited_images_count', 'edit_images', 'editImages'] },
  { stateKey: 'finalImages', label: 'Final', commentLabels: ['Final Images', 'Final'], metadataKeys: ['final_images_count', 'final_images', 'finalImages'] },
];

const PROJECT_IMAGE_COUNT_FIELDS: Record<number, ImageCountFieldConfig[]> = {
  17: [
    { stateKey: 'totalImages', label: 'Total', commentLabels: ['Total Raw Files', 'Total Images', 'Images', 'Total'], metadataKeys: ['total_raw_files', 'images', 'total_images', 'totalImages'], payloadKey: 'total_raw_files' },
    { stateKey: 'normalImages', label: 'Normal', commentLabels: ['Single Images', 'Normal Images', 'Normal'], metadataKeys: ['single_images_count', 'normal_images', 'normalImages', 'normal_final_images', 'normalFinalImages'], payloadKey: 'single_images_count' },
    { stateKey: 'hdrImages', label: 'HDR', commentLabels: ['HDR Images', 'HDR'], metadataKeys: ['hdr_images_count', 'hdr_images', 'hdrImages'], payloadKey: 'hdr_images_count' },
    { stateKey: 'editImages', label: 'Edited', commentLabels: ['Edited Images', 'Edit Images', 'Edited', 'Edit'], metadataKeys: ['edited_images_count', 'edit_images', 'editImages'], payloadKey: 'edited_images_count' },
    { stateKey: 'finalImages', label: 'Final', commentLabels: ['Final Images', 'Final'], metadataKeys: ['final_images_count', 'final_images', 'finalImages'], payloadKey: 'final_images_count' },
  ],
  52: [
    { stateKey: 'totalImages', label: 'Images', commentLabels: ['Total Raw Files', 'Total Images', 'Images', 'Total'], metadataKeys: ['total_raw_files', 'images', 'totalImages'], payloadKey: 'total_raw_files' },
    { stateKey: 'hdrImages', label: 'General QA Image', commentLabels: ['General QA Image', 'HDR'], metadataKeys: ['hdr_images_count', 'hdrImages'], payloadKey: 'hdr_images_count' },
    { stateKey: 'normalImages', label: 'Human Edit', commentLabels: ['Human Edit', 'Normal'], metadataKeys: ['single_images_count', 'normalImages'], payloadKey: 'single_images_count' },
    { stateKey: 'finalImages', label: 'GDPR', commentLabels: ['GDPR', 'Final'], metadataKeys: ['final_images_count', 'finalImages'], payloadKey: 'final_images_count' },
    { stateKey: 'editImages', label: 'Edited Images', commentLabels: ['Edited Images', 'Edited', 'Edit'], metadataKeys: ['edited_images_count', 'editImages'], payloadKey: 'edited_images_count' },
  ],
  50: [
    { stateKey: 'totalImages', label: 'Total RAW Files', commentLabels: ['Total RAW Files', 'Total Raw Files', 'Total Images', 'Total'], metadataKeys: ['project_50_total_raw_files', 'total_raw_files', 'totalImages'] },
    { stateKey: 'totalOutputs', label: 'Total Outputs', commentLabels: ['Total Outputs'], metadataKeys: ['project_50_total_outputs', 'total_outputs'] },
    { stateKey: 'singleExposureImages', label: 'Single Exposure Images', commentLabels: ['Single Exposure Images'], metadataKeys: ['project_50_single_exposure_images', 'single_exposure_images'] },
    { stateKey: 'jpegToHdr', label: 'Jpeg to HDR', commentLabels: ['Jpeg to HDR', 'JPEG to HDR'], metadataKeys: ['project_50_jpeg_to_hdr', 'jpeg_to_hdr'] },
    { stateKey: 'rawToHdrWithoutEdit', label: 'RAW to HDR Without Edit', commentLabels: ['RAW to HDR Without Edit'], metadataKeys: ['project_50_raw_to_hdr_without_edit', 'raw_to_hdr_without_edit'] },
    { stateKey: 'rawToHdrWithBaseEdit', label: 'RAW to HDR With Base Edit', commentLabels: ['RAW to HDR With Base Edit'], metadataKeys: ['project_50_raw_to_hdr_with_base_edit', 'raw_to_hdr_with_base_edit'] },
    { stateKey: 'duskImages', label: 'Dusk Images', commentLabels: ['Dusk Images'], metadataKeys: ['project_50_dusk_images', 'dusk_images'] },
    { stateKey: 'objectRemovalJpegHdrLessThan45', label: 'Object Removal (Jpeg - HDR) Less than 45 minutes', commentLabels: ['Object Removal (Jpeg - HDR) Less than 45 minutes'], metadataKeys: ['project_50_object_removal_jpeg_hdr_less_than_45'] },
    { stateKey: 'objectRemovalJpegHdrMoreThan45', label: 'Object Removal (Jpeg - HDR) More than 45 minutes', commentLabels: ['Object Removal (Jpeg - HDR) More than 45 minutes'], metadataKeys: ['project_50_object_removal_jpeg_hdr_more_than_45'] },
    { stateKey: 'objectRemovalJpegHdrAdvanceDeclutter', label: 'Object Removal (Jpeg - HDR) Advance Declutter', commentLabels: ['Object Removal (Jpeg - HDR) Advance Declutter'], metadataKeys: ['project_50_object_removal_jpeg_hdr_advance_declutter'] },
    { stateKey: 'objectRemovalRawHdrLessThan45', label: 'Object Removal (RAW - HDR) Less than 45 minutes', commentLabels: ['Object Removal (RAW - HDR) Less than 45 minutes'], metadataKeys: ['project_50_object_removal_raw_hdr_less_than_45'] },
    { stateKey: 'objectRemovalRawHdrMoreThan45', label: 'Object Removal (RAW - HDR) More than 45 minutes', commentLabels: ['Object Removal (RAW - HDR) More than 45 minutes'], metadataKeys: ['project_50_object_removal_raw_hdr_more_than_45'] },
    { stateKey: 'objectRemovalRawHdrAdvanceDeclutter', label: 'Object Removal (RAW - HDR) Advance Declutter', commentLabels: ['Object Removal (RAW - HDR) Advance Declutter'], metadataKeys: ['project_50_object_removal_raw_hdr_advance_declutter'] },
    { stateKey: 'aerialBoundriesSingleProperty', label: 'Aerial Shots Boundries Single Property', commentLabels: ['Aerial Shots Boundries Single Property'], metadataKeys: ['project_50_aerial_boundries_single_property'] },
    { stateKey: 'aerialAddingMultipleLocationPins', label: 'Aerial Shots Adding Multiple Location Pins', commentLabels: ['Aerial Shots Adding Multiple Location Pins'], metadataKeys: ['project_50_aerial_adding_multiple_location_pins'] },
    { stateKey: 'aerialBoundriesMultipleProperties', label: 'Aerial Shots Boundries Multiple Properties', commentLabels: ['Aerial Shots Boundries Multiple Properties'], metadataKeys: ['project_50_aerial_boundries_multiple_properties'] },
    { stateKey: 'vfImages', label: 'VF Images', commentLabels: ['VF Images'], metadataKeys: ['project_50_vf_images', 'vf_count'] },
  ],
};

type ImageCountSyncPayload = {
  project_id: number;
  total_raw_files?: string | number | null;
  hdr_images_count?: number | null;
  single_images_count?: number | null;
  final_images_count?: number | null;
  edited_images_count?: number | null;
};

export default function QAWorkForm({ order, onComplete, onClose }: QAWorkFormProps) {
  const metadata = (order.metadata || {}) as Record<string, string>;
  const [details, setDetails] = useState<OrderDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [checklist, setChecklist] = useState<ChecklistItem[]>(() => getInitialChecklist(order.project_id || order.project?.id));
  const [notes, setNotes] = useState('');
  const [showReject, setShowReject] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectCode, setRejectCode] = useState('');
  const [routeTo, setRouteTo] = useState('');
  const [activeTab, setActiveTab] = useState<'checklist' | 'notes' | 'history'>('checklist');
  const [showFlag, setShowFlag] = useState(false);
  const [flagType, setFlagType] = useState('quality_issue');
  const [flagDescription, setFlagDescription] = useState('');
  const [flagSeverity, setFlagSeverity] = useState('medium');
  const [showHelp, setShowHelp] = useState(false);
  const [helpQuestion, setHelpQuestion] = useState('');
  const [editableArea, setEditableArea] = useState(String(metadata.enter_area ?? metadata.area ?? ''));
  const [clientPortalStatus, setClientPortalStatus] = useState<ClientPortalUploadStatus | null>(null);
  const isProject16 = order.project_id === 16;
  const isProject15 = Number(order.project_id || order.project?.id || 0) === 15;
  const isProject13 = Number(order.project_id || order.project?.id || 0) === 13;
  const [cubiBwBugsCount, setCubiBwBugsCount] = useState('');
  const [cubiBwBugsComment, setCubiBwBugsComment] = useState('');
  const [cubiMbOkCount, setCubiMbOkCount] = useState('');
  const [cubiMbOkComment, setCubiMbOkComment] = useState('');
  const [cubiOtherFieldCount, setCubiOtherFieldCount] = useState('');
  const [cubiOtherFieldComment, setCubiOtherFieldComment] = useState('');
  const [cubiOkFieldCount, setCubiOkFieldCount] = useState('');
  const [cubiOkFieldComment, setCubiOkFieldComment] = useState('');

  // PH_2_LAYER image counts
  const isPh2Layer = order.workflow_type === 'PH_2_LAYER';
  const imageCountFields = PROJECT_IMAGE_COUNT_FIELDS[order.project_id] ?? DEFAULT_IMAGE_COUNT_FIELDS;
  const [imageCounts, setImageCounts] = useState<Partial<Record<ImageCountStateKey, string>>>({});
  const getImageCountValue = (stateKey: ImageCountStateKey) => imageCounts[stateKey] ?? '';
  const setImageCountValue = (stateKey: ImageCountStateKey, value: string) => {
    setImageCounts((prev) => ({ ...prev, [stateKey]: value }));
  };

  // Timer
  const [elapsed, setElapsed] = useState(0);
  const [timerRunning, setTimerRunning] = useState(true);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setChecklist(getInitialChecklist(order.project_id || order.project?.id));
    loadDetails();
    workflowService.startTimer(order.id).catch(() => { });
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [order.id, order.project_id, order.project?.id]);

  useEffect(() => {
    if (timerRunning) {
      timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [timerRunning]);

  const loadDetails = async () => {
    try {
      const res = await workflowService.orderFullDetails(order.id);
      setDetails(res.data);

      const checkerArea = getLatestStageArea(res.data.work_items ?? res.data.order?.work_items, 'CHECK');
      if (checkerArea) {
        setEditableArea(checkerArea);
      }

      // For PH_2_LAYER, load image counts from designer's work_items comments
      if (isPh2Layer) {
        const workItems = res.data.work_items ?? res.data.order?.work_items ?? [];
        const designerWorkItem = [...workItems]
          .reverse()
          .find((item: any) => String(item.stage || '').toUpperCase() === 'DESIGN');
        const detailOrder = (res.data?.order || order) as unknown as Record<string, unknown>;
        const metadataSource = ((res.data?.order?.metadata || order.metadata || {}) as Record<string, unknown>);
        const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const extractNumber = (comments: string, labels: string[]) => {
          for (const label of labels) {
            const match = comments.match(new RegExp(`${escapeRegExp(label)}:\\s*(\\d+)`, 'i'));
            if (match) return match[1];
          }
          return '';
        };
        const extractDesignerComment = (comments: string) => {
          const match = comments.match(/(?:^|\n)Comments:\s*([\s\S]*?)(?=\n[A-Z][A-Za-z ]*:\s*|\n*$)/);
          return match?.[1]?.trim() || '';
        };
        const getStoredCount = (keys: string[]) => {
          for (const key of keys) {
            const value = detailOrder[key] ?? metadataSource[key];
            if (value === null || value === undefined || value === '') continue;
            return String(value);
          }
          return '';
        };
        const countsByState: Partial<Record<ImageCountStateKey, string>> = {
          totalImages: '',
          normalImages: '',
          hdrImages: '',
          editImages: '',
          finalImages: '',
        };

        if (designerWorkItem && designerWorkItem.comments) {
          const comments = designerWorkItem.comments;
          const designerComment = extractDesignerComment(comments);
          if (designerComment) {
            setNotes((currentNotes) => currentNotes || designerComment);
          }
          // Parse: "Images — Total: 255, HDR: 200, Edit: 240, Normal: 50, Final: 255"
          imageCountFields.forEach((field) => {
            countsByState[field.stateKey] = extractNumber(comments, field.commentLabels);
          });
        }

        imageCountFields.forEach((field) => {
          if (!countsByState[field.stateKey]) {
            countsByState[field.stateKey] = getStoredCount(field.metadataKeys);
          }
        });

        setImageCounts(countsByState);
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const toggleTimer = async () => {
    try {
      if (timerRunning) {
        await workflowService.stopTimer(order.id);
      } else {
        await workflowService.startTimer(order.id);
      }
      setTimerRunning(!timerRunning);
    } catch (e) { console.error(e); }
  };

  const setItemStatus = (id: string, status: 'yes' | 'no') => {
    setChecklist(prev =>
      prev.map(c => {
        if (c.id === id) {
          const newStatus = c.status === status ? null : status;
          return { ...c, status: newStatus, checked: newStatus === 'yes' };
        }
        return c;
      })
    );
  };

  const visibleChecklist = isPh2Layer ? [] : checklist;
  const allChecked = isPh2Layer ? true : checklist.every(c => c.checked);
  const checkedCount = isPh2Layer ? visibleChecklist.length : checklist.filter(c => c.checked).length;
  const project13AnsweredCount = checklist.filter(c => c.status === 'yes' || c.status === 'no').length;
  const project13AllAnswered = isProject13 ? project13AnsweredCount === checklist.length : false;
  const checklistRequirementMet = isPh2Layer || isProject16 || isProject15 || (isProject13 ? project13AllAnswered : allChecked);

  const handleApprove = async () => {
    if (!checklistRequirementMet) return;
    const hasAnyImageCount = imageCountFields.some((field) => getImageCountValue(field.stateKey));
    if (isPh2Layer && !hasAnyImageCount) return;
    if (clientPortalStatus?.required && !clientPortalStatus.submitted) return;
    setSubmitting(true);
    try {
      const checklistSummary = !isPh2Layer
        ? isProject13
          ? checklist.map(c => {
              const remark = c.status === 'yes' ? 'YES' : c.status === 'no' ? 'NO' : 'UNANSWERED';
              const icon = c.status === 'yes' ? '✓' : c.status === 'no' ? '✗' : '—';
              return `${icon} [${remark}] ${c.label}`;
            }).join('\n')
          : isProject15
            ? checklist.map(c => `${c.checked ? '✓ [PASS]' : '✗ [UNCHECKED]'} ${c.category ? `(${c.category}) ` : ''}${c.label}`).join('\n')
            : checklist.map(c => `✓ ${c.label}`).join('\n')
        : '';
      const areaSummary = editableArea.trim() ? `\nArea: ${editableArea.trim()}` : '';
      const imageCountValues = imageCounts;
      const imageCountSummary = isPh2Layer && hasAnyImageCount
        ? `\nPhoto Selections - ${imageCountFields.map((field) => `${field.label}: ${imageCountValues[field.stateKey] || 0}`).join(', ')}`
        : '';
      const cubiQaDetailsSummary = isProject16
        ? [
          cubiBwBugsCount.trim() || cubiBwBugsComment.trim()
            ? `\nCubi QA Details:\n- BW Bugs Count: ${cubiBwBugsCount.trim() || '0'}\n- BW Bugs Comment: ${cubiBwBugsComment.trim() || '—'}`
            : '',
          cubiMbOkCount.trim() || cubiMbOkComment.trim()
            ? `\n- MB OK Count: ${cubiMbOkCount.trim() || '0'}\n- MB OK Comment: ${cubiMbOkComment.trim() || '—'}`
            : '',
          cubiOtherFieldCount.trim() || cubiOtherFieldComment.trim()
            ? `\n- Other Field Count: ${cubiOtherFieldCount.trim() || '0'}\n- Other Field Comment: ${cubiOtherFieldComment.trim() || '—'}`
            : '',
          cubiOkFieldCount.trim() || cubiOkFieldComment.trim()
            ? `\n- OK Field Count: ${cubiOkFieldCount.trim() || '0'}\n- OK Field Comment: ${cubiOkFieldComment.trim() || '—'}`
            : '',
        ].filter(Boolean).join('')
        : '';
      const comment = `QA Approved${checklistSummary ? `\n\nChecklist:\n${checklistSummary}` : ''}${areaSummary}${imageCountSummary}${cubiQaDetailsSummary}${notes ? `\n\nNotes: ${notes}` : ''}`;
      await workflowService.submitWork(order.id, comment);

      if (isPh2Layer && imageCountFields.some((field) => field.payloadKey)) {
        const parseOptionalCount = (value: string): number | null => {
          const trimmed = value.trim();
          if (trimmed === '') return null;
          if (!/^\d+$/.test(trimmed)) return null;
          return Number(trimmed);
        };
        const getCurrentOrder = (): Record<string, unknown> => (
          (details?.order || order) as unknown as Record<string, unknown>
        );
        const normalizeCurrentString = (value: unknown): string | null => (
          value === null || value === undefined || value === '' ? null : String(value)
        );
        const normalizeCurrentCount = (value: unknown): number | null => {
          if (value === null || value === undefined || value === '') return null;
          const count = Number(value);
          return Number.isFinite(count) ? count : null;
        };

        const parsedTotalImages = parseOptionalCount(getImageCountValue('totalImages'));
        const parsedNormalImages = parseOptionalCount(getImageCountValue('normalImages'));
        const parsedHdrImages = parseOptionalCount(getImageCountValue('hdrImages'));
        const parsedEditImages = parseOptionalCount(getImageCountValue('editImages'));
        const parsedFinalImages = parseOptionalCount(getImageCountValue('finalImages'));

        const parsedByState: Partial<Record<ImageCountStateKey, number | null>> = {
          totalImages: parsedTotalImages,
          normalImages: parsedNormalImages,
          hdrImages: parsedHdrImages,
          editImages: parsedEditImages,
          finalImages: parsedFinalImages,
        };

        const nextByPayloadKey = imageCountFields.reduce<Record<ImageCountPayloadKey, string | number | null>>((nextValues, field) => {
          if (!field.payloadKey) return nextValues;

          nextValues[field.payloadKey] = field.payloadKey === 'total_raw_files'
            ? (parsedByState[field.stateKey] === null ? null : String(parsedByState[field.stateKey]))
            : (parsedByState[field.stateKey] ?? null);
          return nextValues;
        }, {} as Record<ImageCountPayloadKey, string | number | null>);

        if (order.project_id === 17 && Object.prototype.hasOwnProperty.call(nextByPayloadKey, 'total_raw_files')) {
          const totalRawFiles = parsedTotalImages
            ?? ((parsedNormalImages ?? 0) + (parsedHdrImages ?? 0));
          nextByPayloadKey.total_raw_files = String(totalRawFiles);
        }

        const currentOrder = getCurrentOrder();
        const currentByPayloadKey: Record<ImageCountPayloadKey, string | number | null> = {
          total_raw_files: normalizeCurrentString(currentOrder.total_raw_files),
          hdr_images_count: normalizeCurrentCount(currentOrder.hdr_images_count),
          single_images_count: normalizeCurrentCount(currentOrder.single_images_count),
          final_images_count: normalizeCurrentCount(currentOrder.final_images_count),
          edited_images_count: normalizeCurrentCount(currentOrder.edited_images_count),
        };

        const countPayload = Object.entries(nextByPayloadKey).reduce<ImageCountSyncPayload>((payload, [key, nextValue]) => {
          const payloadKey = key as ImageCountPayloadKey;
          if (currentByPayloadKey[payloadKey] !== nextValue) {
            return {
              ...payload,
              [payloadKey]: nextValue,
            };
          }
          return payload;
        }, { project_id: order.project_id });

        if (Object.keys(countPayload).length > 1) {
          try {
            await workflowService.updateInstruction(order.id, countPayload);
          } catch (syncError) {
            console.warn('QA submit succeeded, but image count sync failed.', syncError);
          }
        }
      }

      onComplete();
    } catch (e) { console.error(e); }
    finally { setSubmitting(false); }
  };

  const handleReject = async () => {
    if (!rejectCode || !rejectReason || rejectReason.length < 10) return;
    setSubmitting(true);
    try {
      await workflowService.rejectOrder(order.id, rejectReason, rejectCode, routeTo || undefined);
      onComplete();
    } catch (e) { console.error(e); }
    finally { setSubmitting(false); }
  };

  const handleFlag = async () => {
    if (!flagDescription) return;
    try {
      await workflowService.flagIssue(order.id, flagType, flagDescription, flagSeverity);
      setShowFlag(false);
      setFlagDescription('');
    } catch (e) { console.error(e); }
  };

  const handleHelp = async () => {
    if (!helpQuestion) return;
    try {
      await workflowService.requestHelp(order.id, helpQuestion);
      setShowHelp(false);
      setHelpQuestion('');
    } catch (e) { console.error(e); }
  };

  const toggleCheck = (id: string) => {
    setChecklist(prev => prev.map(c => c.id === id ? { ...c, checked: !c.checked } : c));
  };

  const formatTime = (raw: number) => {
    const s = Math.max(0, Math.floor(raw));
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    return h > 0 ? `${h}h ${m % 60}m ${s % 60}s` : `${m}m ${s % 60}s`;
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="relative ml-auto w-full max-w-2xl bg-white shadow-2xl flex flex-col h-full overflow-hidden animate-slide-in-right">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-6 py-4 border-b border-slate-200 bg-slate-50">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <div className="p-2 bg-emerald-100 rounded-lg">
              <Eye className="h-5 w-5 text-emerald-700" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold text-slate-900">QA Review</h2>
              <p className="text-xs leading-snug text-slate-500 break-words">{order.order_number} · {metadata.address || order.client_reference || '—'}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {/* Timer */}
            <button
              onClick={toggleTimer}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${timerRunning ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                }`}
            >
              <Clock className="h-3.5 w-3.5" />
              {formatTime(elapsed)}
            </button>
            <button onClick={onClose} title="Close" className="p-1.5 hover:bg-slate-200 rounded-lg transition-colors">
              <X className="h-5 w-5 text-slate-500" />
            </button>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="flex items-center gap-2 px-6 py-3 border-b border-slate-100">
          <button
            onClick={() => setShowFlag(!showFlag)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors"
          >
            <Flag className="h-3.5 w-3.5" /> Flag Issue
          </button>
          <button
            onClick={() => setShowHelp(!showHelp)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
          >
            <HelpCircle className="h-3.5 w-3.5" /> Request Help
          </button>
          {!isPh2Layer && (
            <div className="ml-auto flex items-center gap-1.5">
              <span className="text-xs text-slate-500">Checklist:</span>
              <span className={`text-xs font-semibold ${
                isProject13
                  ? project13AllAnswered ? 'text-emerald-600' : 'text-amber-600'
                  : isProject15 || allChecked ? 'text-emerald-600' : 'text-amber-600'
              }`}>
                {isProject13
                  ? `${project13AnsweredCount}/${checklist.length}`
                  : `${checkedCount}/${checklist.length}`}
              </span>
            </div>
          )}
        </div>

        {/* Flag Panel */}
        {showFlag && (
          <div className="px-6 py-3 bg-amber-50 border-b border-amber-100 space-y-2">
            <div className="flex gap-2">
              <Select id="flag-type" value={flagType} onChange={e => setFlagType(e.target.value)} className="text-xs flex-1">
                <option value="quality_issue">Quality Issue</option>
                <option value="missing_data">Missing Data</option>
                <option value="client_specs">Client Spec Issue</option>
              </Select>
              <Select id="flag-sev" value={flagSeverity} onChange={e => setFlagSeverity(e.target.value)} className="text-xs">
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </Select>
            </div>
            <div className="flex gap-2">
              <input
                className="flex-1 text-xs rounded-lg border border-amber-200 px-3 py-1.5 focus:ring-amber-500 focus:border-amber-500"
                placeholder="Describe the issue..."
                value={flagDescription}
                onChange={e => setFlagDescription(e.target.value)}
              />
              <Button size="sm" onClick={handleFlag} disabled={!flagDescription}>Submit</Button>
            </div>
          </div>
        )}

        {/* Help Panel */}
        {showHelp && (
          <div className="px-6 py-3 bg-blue-50 border-b border-blue-100">
            <div className="flex gap-2">
              <input
                className="flex-1 text-xs rounded-lg border border-blue-200 px-3 py-1.5 focus:ring-blue-500 focus:border-blue-500"
                placeholder="What do you need help with?"
                value={helpQuestion}
                onChange={e => setHelpQuestion(e.target.value)}
              />
              <Button size="sm" onClick={handleHelp} disabled={!helpQuestion}>Ask</Button>
            </div>
          </div>
        )}

        {/* Order Info */}
        <div className="px-6 py-3 border-b border-slate-100 bg-slate-50/50">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div>
              <span className="text-slate-400">Priority</span>
              <div className={`font-semibold mt-0.5 ${order.priority === 'urgent' ? 'text-red-600' : order.priority === 'high' ? 'text-amber-600' : 'text-slate-700'}`}>
                {order.priority}
              </div>
            </div>
            <div>
              <span className="text-slate-400">Due Date</span>
              <div className="font-semibold text-slate-700 mt-0.5">{order.due_date ? new Date(order.due_date).toLocaleDateString() : '—'}</div>
            </div>
            <div>
              <span className="text-slate-400">Client Ref</span>
              <div className="font-semibold text-slate-700 mt-0.5">{order.client_reference || '—'}</div>
            </div>
            <div>
              <span className="text-slate-400">Rejection Count</span>
              <div className="font-semibold text-slate-700 mt-0.5">{(order as any).rejection_count ?? 0}</div>
            </div>
          </div>
          {order.rejection_reason && (
            <div className="mt-2 p-2 bg-rose-50 rounded-lg text-xs text-rose-700">
              <span className="font-medium">Previous Rejection:</span> {order.rejection_reason}
            </div>
          )}
        </div>

        {/* Tab Bar */}
        <div className="flex items-center gap-1 px-6 pt-3 border-b border-slate-100">
          {[
            { id: 'checklist' as const, label: 'Quality Checklist', icon: CheckCircle2 },
            { id: 'notes' as const, label: 'Notes', icon: MessageSquare },
            { id: 'history' as const, label: 'History', icon: History },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${activeTab === tab.id
                ? 'border-brand-500 text-brand-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
            >
              <tab.icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-16 bg-slate-100 animate-pulse rounded-lg" />
              ))}
            </div>
          ) : (
            <>
              {/* Checklist Tab */}
              {activeTab === 'checklist' && (
                <div className="space-y-3">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <label htmlFor="qa-area" className="mb-1.5 block text-xs font-semibold text-slate-700">
                      Area
                    </label>
                    <input
                      id="qa-area"
                      type="text"
                      value={editableArea}
                      onChange={e => setEditableArea(e.target.value)}
                      placeholder="Please write area with its unit"
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                    />
                  </div>
                  {isProject16 && (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <label className="mb-2 block text-xs font-semibold text-slate-700">Cubi QA Details</label>
                      <p className="mb-3 text-[11px] text-slate-500">These values are saved with the QA submission comment for now.</p>
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="rounded-lg border border-slate-200 bg-white p-3">
                          <label className="mb-1 block text-xs font-semibold text-slate-700">BW Count</label>
                          <input
                            type="number"
                            min="0"
                            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                            placeholder="0"
                            value={cubiBwBugsCount}
                            onChange={(e) => setCubiBwBugsCount(e.target.value)}
                          />
                          <label className="mt-2 mb-1 block text-xs font-semibold text-slate-700">BW Comment</label>
                          <textarea
                            rows={2}
                            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                            placeholder="Add notes for BW Bugs"
                            value={cubiBwBugsComment}
                            onChange={(e) => setCubiBwBugsComment(e.target.value)}
                          />
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-white p-3">
                          <label className="mb-1 block text-xs font-semibold text-slate-700">MB OK Count</label>
                          <input
                            type="number"
                            min="0"
                            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                            placeholder="0"
                            value={cubiMbOkCount}
                            onChange={(e) => setCubiMbOkCount(e.target.value)}
                          />
                          <label className="mt-2 mb-1 block text-xs font-semibold text-slate-700">MB OK Comment</label>
                          <textarea
                            rows={2}
                            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                            placeholder="Add notes for MB OK"
                            value={cubiMbOkComment}
                            onChange={(e) => setCubiMbOkComment(e.target.value)}
                          />
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-white p-3">
                          <label className="mb-1 block text-xs font-semibold text-slate-700">Other Field Count</label>
                          <input
                            type="number"
                            min="0"
                            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                            placeholder="0"
                            value={cubiOtherFieldCount}
                            onChange={(e) => setCubiOtherFieldCount(e.target.value)}
                          />
                          <label className="mt-2 mb-1 block text-xs font-semibold text-slate-700">Other Field Comment</label>
                          <textarea
                            rows={2}
                            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                            placeholder="Add notes for the other field"
                            value={cubiOtherFieldComment}
                            onChange={(e) => setCubiOtherFieldComment(e.target.value)}
                          />
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-white p-3">
                          <label className="mb-1 block text-xs font-semibold text-slate-700">OK Field Count</label>
                          <input
                            type="number"
                            min="0"
                            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                            placeholder="0"
                            value={cubiOkFieldCount}
                            onChange={(e) => setCubiOkFieldCount(e.target.value)}
                          />
                          <label className="mt-2 mb-1 block text-xs font-semibold text-slate-700">OK Field Comment</label>
                          <textarea
                            rows={2}
                            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                            placeholder="Add notes for OK field"
                            value={cubiOkFieldComment}
                            onChange={(e) => setCubiOkFieldComment(e.target.value)}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                  {/* PH_2_LAYER Photo Selections */}
                  {isPh2Layer && (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <label className="mb-2 block text-xs font-semibold text-slate-700">Photo Selections</label>
                      <div className="grid grid-cols-3 gap-3 md:grid-cols-5">
                        {imageCountFields.map((field) => {
                          return (
                            <div key={field.label}>
                              <label className="block text-xs text-slate-500 mb-1">{field.label}</label>
                              <input
                                type="number"
                                min="0"
                                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                                placeholder="0"
                                value={getImageCountValue(field.stateKey)}
                                onChange={e => setImageCountValue(field.stateKey, e.target.value)}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  <QAClientPortalUpload order={order} onStatusChange={setClientPortalStatus} />

                  {!isPh2Layer && (
                    <div className="space-y-3">
                      {checklist.length > 6 && (
                        <div className="flex items-center justify-between px-1 pb-1">
                          <span className="text-xs font-semibold text-slate-600">
                            Checklist Items ({isProject13 ? `${checklist.filter(c => c.status === 'yes' || c.status === 'no').length}/${checklist.length}` : `${checkedCount}/${checklist.length}`})
                          </span>
                          {isProject13 ? (
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setChecklist(prev => prev.map(c => ({ ...c, status: 'yes', checked: true })))}
                                className="text-xs font-medium text-emerald-600 hover:text-emerald-700 hover:underline"
                              >
                                All Yes
                              </button>
                              <span className="text-slate-300">|</span>
                              <button
                                type="button"
                                onClick={() => setChecklist(prev => prev.map(c => ({ ...c, status: 'no', checked: false })))}
                                className="text-xs font-medium text-rose-600 hover:text-rose-700 hover:underline"
                              >
                                All No
                              </button>
                              <span className="text-slate-300">|</span>
                              <button
                                type="button"
                                onClick={() => setChecklist(prev => prev.map(c => ({ ...c, status: null, checked: false })))}
                                className="text-xs font-medium text-slate-500 hover:text-slate-700 hover:underline"
                              >
                                Reset
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setChecklist(prev => prev.map(c => ({ ...c, checked: true })))}
                                className="text-xs font-medium text-emerald-600 hover:text-emerald-700 hover:underline"
                              >
                                Check All
                              </button>
                              <span className="text-slate-300">|</span>
                              <button
                                type="button"
                                onClick={() => setChecklist(prev => prev.map(c => ({ ...c, checked: false })))}
                                className="text-xs font-medium text-slate-500 hover:text-slate-700 hover:underline"
                              >
                                Uncheck All
                              </button>
                            </div>
                          )}
                        </div>
                      )}

                      {checklist.map((item, idx) => {
                        const showCategoryHeader = item.category && (idx === 0 || checklist[idx - 1].category !== item.category);
                        return (
                          <div key={item.id} className="space-y-2">
                            {showCategoryHeader && (
                              <div className="pt-2 pb-0.5 first:pt-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-bold uppercase tracking-wider text-slate-700 bg-slate-100 px-2.5 py-1 rounded-md border border-slate-200">
                                    {item.category}
                                  </span>
                                  <div className="h-px flex-1 bg-slate-200" />
                                </div>
                              </div>
                            )}
                            {item.type === 'yes_no' ? (
                              <div
                                className={`w-full flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl border transition-all ${
                                  item.status === 'yes'
                                    ? 'border-emerald-200 bg-emerald-50/50'
                                    : item.status === 'no'
                                    ? 'border-rose-200 bg-rose-50/50'
                                    : 'border-slate-200 bg-white hover:border-slate-300'
                                }`}
                              >
                                <div className="flex-1 min-w-0 pr-2">
                                  <div
                                    className={`text-sm font-semibold ${
                                      item.status === 'yes'
                                        ? 'text-emerald-900'
                                        : item.status === 'no'
                                        ? 'text-rose-900'
                                        : 'text-slate-900'
                                    }`}
                                  >
                                    {item.label}
                                  </div>
                                  {item.description && (
                                    <div
                                      className={`text-xs mt-1.5 whitespace-pre-line leading-relaxed ${
                                        item.status === 'yes'
                                          ? 'text-emerald-700'
                                          : item.status === 'no'
                                          ? 'text-rose-700'
                                          : 'text-slate-600'
                                      }`}
                                    >
                                      {item.description}
                                    </div>
                                  )}
                                </div>
                                <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                                  <button
                                    type="button"
                                    onClick={() => setItemStatus(item.id, 'yes')}
                                    className={`px-4 py-2 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 ${
                                      item.status === 'yes'
                                        ? 'bg-emerald-600 text-white shadow-md shadow-emerald-200 ring-2 ring-emerald-500/50'
                                        : 'bg-slate-100 text-slate-600 hover:bg-emerald-50 hover:text-emerald-700'
                                    }`}
                                  >
                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                    Yes
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setItemStatus(item.id, 'no')}
                                    className={`px-4 py-2 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 ${
                                      item.status === 'no'
                                        ? 'bg-rose-600 text-white shadow-md shadow-rose-200 ring-2 ring-rose-500/50'
                                        : 'bg-slate-100 text-slate-600 hover:bg-rose-50 hover:text-rose-700'
                                    }`}
                                  >
                                    <X className="h-3.5 w-3.5" />
                                    No
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => toggleCheck(item.id)}
                                className={`w-full flex items-start gap-3 p-4 rounded-xl border transition-all text-left ${
                                  item.checked
                                    ? 'border-emerald-200 bg-emerald-50/50'
                                    : 'border-slate-200 bg-white hover:border-slate-300'
                                }`}
                              >
                                {item.checked ? (
                                  <CheckCircle2 className="h-5 w-5 text-emerald-600 mt-0.5 flex-shrink-0" />
                                ) : (
                                  <Circle className="h-5 w-5 text-slate-300 mt-0.5 flex-shrink-0" />
                                )}
                                <div className="flex-1 min-w-0">
                                  <div
                                    className={`text-sm font-medium ${
                                      item.checked ? 'text-emerald-800' : 'text-slate-900'
                                    }`}
                                  >
                                    {item.label}
                                  </div>
                                  {item.description && (
                                    <div
                                      className={`text-xs mt-0.5 ${
                                        item.checked ? 'text-emerald-600' : 'text-slate-500'
                                      }`}
                                    >
                                      {item.description}
                                    </div>
                                  )}
                                </div>
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Notes Tab */}
              {activeTab === 'notes' && (
                <div className="space-y-4">
                  <Textarea
                    id="qa-notes"
                    label="QA Notes"
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    placeholder="Add any observations, special notes, or feedback for the team..."
                    rows={8}
                    showCharCount
                    maxLength={1000}
                    currentLength={notes.length}
                  />
                  {metadata.client_standards && (
                    <div className="p-3 bg-blue-50 rounded-lg text-xs text-blue-700">
                      <span className="font-medium">Client Standards:</span> {metadata.client_standards}
                    </div>
                  )}
                </div>
              )}

              {/* History Tab */}
              {activeTab === 'history' && details && (
                <div className="space-y-4">
                  {details.work_items && details.work_items.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-slate-500 uppercase mb-2">Work History</h4>
                      <div className="space-y-2">
                        {details.work_items
                          .filter((item) => item.comments || item.rework_reason || item.rejection_code)
                          .map((item) => (
                            <div key={item.id} className="p-3 bg-slate-50 rounded-lg text-xs">
                              <div className="mb-1 flex flex-wrap items-center gap-2 text-slate-500">
                                <span className="font-semibold text-slate-700">{item.stage}</span>
                                {item.assignedUser?.name && <span>{item.assignedUser.name}</span>}
                                {item.completed_at && <span>{new Date(item.completed_at).toLocaleString()}</span>}
                              </div>
                              {item.comments && (
                                <div className="whitespace-pre-wrap text-slate-700">{item.comments}</div>
                              )}
                              {item.rework_reason && (
                                <div className="mt-1 text-rose-700">Rework: {item.rework_reason}</div>
                              )}
                              {item.rejection_code && (
                                <div className="mt-1 text-rose-700">Code: {item.rejection_code}</div>
                              )}
                            </div>
                          ))}
                      </div>
                    </div>
                  )}
                  {details.help_requests && details.help_requests.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-slate-500 uppercase mb-2">Help Requests</h4>
                      <div className="space-y-2">
                        {details.help_requests.map((hr: any, i: number) => (
                          <div key={i} className="p-3 bg-slate-50 rounded-lg text-xs">
                            <span className="text-slate-700">{hr.question || hr.description || JSON.stringify(hr)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {details.issue_flags && details.issue_flags.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-slate-500 uppercase mb-2">Issue Flags</h4>
                      <div className="space-y-1.5">
                        {details.issue_flags.map((flag: any, i: number) => (
                          <div key={i} className="flex items-start gap-2 text-xs py-1.5">
                            <div className="w-1.5 h-1.5 rounded-full bg-amber-400 mt-1.5 flex-shrink-0" />
                            <span className="text-slate-700">{flag.description || JSON.stringify(flag)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {details.supervisor_notes && (
                    <div>
                      <h4 className="text-xs font-semibold text-slate-500 uppercase mb-2">Supervisor Notes</h4>
                      <div className="p-3 bg-blue-50 rounded-lg text-xs text-blue-700">{details.supervisor_notes}</div>
                    </div>
                  )}
                  {(!details.work_items?.some((item) => item.comments || item.rework_reason || item.rejection_code) && !details.help_requests?.length && !details.issue_flags?.length && !details.supervisor_notes) && (
                    <div className="text-center py-8 text-sm text-slate-400">No history available for this order.</div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Reject Panel */}
        {showReject && (
          <div className="px-6 py-4 border-t border-rose-200 bg-rose-50 space-y-3">
            <h4 className="text-sm font-semibold text-rose-800">Reject Order</h4>
            <Select
              id="reject-code"
              label="Rejection Code"
              required
              value={rejectCode}
              onChange={e => setRejectCode(e.target.value)}
            >
              <option value="">Select reason code...</option>
              {REJECTION_CODES.map(c => (
                <option key={c} value={c}>{c.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</option>
              ))}
            </Select>
            <Textarea
              id="reject-reason"
              label="Issue Details"
              required
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              placeholder="Describe the issue in detail (minimum 10 characters)..."
              rows={3}
              showCharCount
              maxLength={500}
              currentLength={rejectReason.length}
            />
            <Select
              id="route-to"
              label="Route to"
              value={routeTo}
              onChange={e => setRouteTo(e.target.value)}
              hint="Leave as Auto to route to the previous stage"
            >
              <option value="">Auto (previous stage)</option>
              <option value="draw">Drawing Stage</option>
              <option value="check">Checking Stage</option>
            </Select>
            <div className="flex items-center gap-2">
              <Button variant="secondary" onClick={() => setShowReject(false)} className="flex-1">Cancel</Button>
              <Button
                variant="danger"
                onClick={handleReject}
                loading={submitting}
                disabled={!rejectCode || !rejectReason || rejectReason.length < 10}
                className="flex-1"
              >
                Confirm Reject
              </Button>
            </div>
          </div>
        )}

        {/* Footer Actions */}
        {!showReject && (
          <div className="px-6 py-4 border-t border-slate-200 bg-white flex items-center gap-3">
            <Button
              variant="danger"
              onClick={() => setShowReject(true)}
              icon={<X className="h-4 w-4" />}
              className="flex-1" >

              Reject
            </Button>
            <Button
              onClick={handleApprove}
              loading={submitting}
              disabled={
                (isPh2Layer ? !imageCountFields.some((field) => getImageCountValue(field.stateKey)) : !checklistRequirementMet)
                || (clientPortalStatus?.required === true && !clientPortalStatus.submitted)
              }
              icon={<Send className="h-4 w-4" />}
              className="flex-[2] bg-emerald-600 hover:bg-emerald-700 focus-visible:ring-emerald-500/30"
            >
              {isPh2Layer || isProject16 || isProject15 || (isProject13 ? project13AllAnswered : allChecked)
                ? 'Approve & Deliver'
                : isProject13
                ? `Complete Checklist (${project13AnsweredCount}/${checklist.length})`
                : `Complete Checklist (${checkedCount}/${checklist.length})`}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
