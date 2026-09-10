// English runtime strings — only text that JS still generates at runtime
// (toasts, confirm dialogs, template messages). Static page text lives
// directly in each /en/*.html file instead of a data-i18n attribute.
window.CURRENT_LANG = 'en';

const T = {
  notificationsTitle: 'Notifications', notifBellLabel: 'Notifications',
  notifEmpty: 'Nothing here yet.', notifMarkAllRead: 'Mark all read',
  notifLikedYourArtwork: 'liked your artwork',
  notifCommented: 'commented: {preview}', notifReplied: 'replied: {preview}',
  notifCommentedOnArtwork: 'commented on your artwork', notifRepliedToComment: 'replied to your comment',
  notifFollowedYou: 'started following you',
  guest: 'Guest', signIn: 'Sign in', myProfile: 'My Profile',
  loading: 'Loading…', anonymous: 'Anonymous', optionalHint: '(optional)',
  moreLabel: 'more', deleteLabel: 'Delete', replyLabel: 'Reply',
  writeAReplyPlaceholder: 'Write a reply…',
  areYouSure: 'Are you sure?', continueLabel: 'Continue',
  imageUploadFailed: 'Image upload failed: {msg}', imageTooLarge: 'Image too large — max 8 MB',
  couldNotUpdateLike: 'Could not update like', couldNotUpdateCollection: 'Could not update exhibition',
  couldNotUpdateFollowUser: 'Could not update follow', followLabel: 'Follow', followingLabel: 'Following',
  followingCountLabel: '{n} Following', followersCountLabel: '{n} Followers',
  followingListTitle: 'Following', followersListTitle: 'Followers', noOneYet: 'No one yet.',
  deleteArtworkTitle: 'Delete artwork?',
  deleteArtworkMessage: "Delete this artwork? This can't be undone, and its cell will open up for a new submission.",
  couldNotDeleteArtwork: 'Could not delete artwork', artworkDeleted: 'Artwork deleted',
  noCommentsYet: 'No comments yet.',
  couldNotPostComment: 'Could not post comment', couldNotDeleteComment: 'Could not delete comment',
  archivedBadge: 'Archived',
  viewingNetwork: "viewing {name}'s network",
  userNotFound: 'User not found',
  completeYourProfile: 'Complete Your Profile', welcomeToWeavo: 'Welcome to Weavo', editProfile: 'Edit Profile',
  requiredNoteCountryOnly: 'Select your country to finish setting up your account.',
  requiredNoteFull: 'Set a username and select your country to finish creating your account.',
  usernameRequired: 'Username is required to continue.', pleaseSelectCountry: 'Please select your country.',
  invalidLinkUrl: "That {label} link doesn't look like a valid URL.",
  usernameTaken: 'That username is taken.', couldNotSaveTryAgain: 'Could not save. Try again.',
  usernameChecking: 'Checking…', usernameAvailable: '✓ This name is available', usernameTakenShort: '✕ Someone already uses this name',
  usernameTooShort: '✕ Use 2–30 characters', usernameInvalidChars: "✕ The / and \\ characters aren't allowed", usernameReserved: "✕ This name can't be used",
  welcomeToast: 'Welcome!', profileSavedToast: 'Profile saved',
  deleteAccountTitle: 'Delete your account?', deleteAccountConfirmLabel: 'Delete my account',
  deleteAccountMessage: "This permanently deletes your account, profile, artwork, comments, exhibitions, and follows. This can't be undone. Type your username, {username}, below to confirm.",
  couldNotDeleteAccount: 'Could not delete account. Try again.', accountDeleted: 'Your account has been deleted.',
  setupLater: 'Not now (browse as a guest)', setupLaterDone: 'Signed out. Sign in again any time to finish setting up.',
  cancelSignup: 'Cancel sign-up (delete this account)', cancelSignupTitle: 'Cancel sign-up?', cancelSignupConfirmLabel: 'Cancel sign-up',
  cancelSignupMessage: 'This deletes the account that was just created for this sign-in. Nothing else is affected, and you can sign up again any time.',
  signupCancelled: 'Sign-up cancelled — the account was deleted.',
  couldNotLoadProjects: 'Could not load campaigns',
  couldNotLoadArtists: 'Could not load artists',
  couldNotLoadArtworks: 'Could not load artworks',
  couldNotLoadArtworks: 'Could not load artworks',
  untitledArtwork: 'Untitled artwork',
  goToProject: 'Go to campaign {n}',
  goToSlide: 'Go to slide {n}',
  projectNotFound: 'Campaign not found',
  archivedIterationLabel: 'This is an archived iteration (v{version}) — frozen the way it looked before a reshape.',
  enlargePreview: 'Enlarge reference preview', shrinkPreview: 'Shrink reference preview',
  couldNotLoadWeavo: 'Could not load weavo',
  pledgeAmountInvalid: 'The pledge amount must be a whole number of 0 or more.', sponsorNotSaved: 'Pledge partner details were not saved — run supabase_mosaic_sponsor.sql first.',
  heroPartnerNamed: 'the pledging partner, {name},', adminPledgeLine: 'pledge ₩{amount}',
  titleRequired: 'Title is required.', addReferenceImage: 'Add a reference image.',
  widthHeightRange: 'Width and height must be 1-100, and no more than 10,000 cells total.',
  creatingProject: 'Creating campaign…',
  imageFullyTransparent: 'This image is fully transparent — nothing to build a weavo from.',
  couldNotCreateProjectMsg: 'Could not create campaign: {msg}',
  couldNotCreateProjectRetry: 'Could not create campaign — try again',
  couldNotReshapeProjectRetry: 'Could not reshape campaign — try again.',
  reshapeConfirmMessage: '{count} already-submitted piece{plural} will be redistributed onto the new grid based on closest color match. This can\'t be undone. Continue?',
  reshapeConfirmMessageWithDrop: '{count} already-submitted pieces will be redistributed onto the new, smaller grid — {dropped} of them won\'t fit and will be returned to their artists\' profiles instead. This can\'t be undone. Continue?',
  reshapeConfirmTitle: 'Reshape this weavo?', reshapeConfirmOk: 'Reshape',
  reshapingProject: 'Reshaping grid and redistributing artwork…',
  couldNotReshapeProjectMsg: 'Could not reshape campaign: {msg}',
  projectReshaped: 'Grid reshaped — artwork redistributed!',
  projectReshapedWithDrop: 'Grid reshaped — {dropped} piece(s) returned to their artists\' profiles.',
  addImageFirst: 'Add an image first.', linkMustBeValidUrl: 'That link needs to be a valid http(s) URL.',
  findingBestSpot: 'Finding the best spot…', couldNotSubmitRetry: 'Could not submit — try again',
  uploadRateLimited: 'Too many uploads in a short time — please wait a few minutes and try again.',
  uploadingToast: 'Uploading…',
  artworkMatchedToast: 'Your artwork found a match and is part of a campaign!',
  artworkPooledToast: 'Added to your profile — waiting for a good match.',
  artworkPiecesPlacedToast: '{placed} of {total} pieces joined the campaign mosaic!', artworkPiecesPooledToast: 'Added to your profile — pieces join the mosaic when open cells match their colours.',
  piecesFailed: 'Could not cut the artwork into pieces — an admin can redo it from the admin page.',
  pieceOfArtwork: 'Row {row}, column {col} of the {n}×{n} cut', piecesInCampaign: '{n} pieces',
  artworkPieceUsage: '{placed}/{total} pieces in the campaign mosaic ({pct}%)',
  waitingForMatchBadge: 'Waiting for a match',
  removeFromProjectTitle: 'Remove from campaign?',
  removeFromProjectLabel: 'Remove',
  removeFromProjectMessage: "Remove this piece from its campaign? It won't be deleted — it goes back to the artist's profile and can be matched into a campaign again later.",
  couldNotRemoveArtwork: 'Could not remove artwork — try again',
  artworkRemovedFromProject: 'Artwork removed from campaign — back in the artist\'s pool.',
  projectCreated: 'Campaign created!',
  artistAvatarAlt: '{name}’s profile picture',
  artworkThumbAlt: '“{title}” by {name}',
  artworkImgAltFallback: 'Artwork by {name}',
  artworkNotFound: 'Artwork not found',
  projectPreviewAlt: 'Reference image for the “{title}” campaign',
  projectsCrumb: 'Campaigns',
  collectionsCrumb: 'Exhibitions',
  newCollectionLabel: 'New Exhibition',
  couldNotCreateCollectionMsg: 'Could not create exhibition: {msg}',
  couldNotCreateCollectionRetry: 'Could not create exhibition — try again',
  collectionCreatedToast: 'Exhibition created!',
  couldNotLoadCollections: 'Could not load exhibitions',
  collectionNotFound: 'Exhibition not found',
  noCollectionsYet: 'No exhibitions yet.',
  addToCollectionLabel: 'Add to exhibition',
  removeFromCollection: 'Remove from exhibition',
  privateBadge: 'Private',
  deleteCollectionTitle: 'Delete this exhibition?',
  deleteCollectionMessage: "This deletes the exhibition itself, not the artwork in it — pieces stay saved and simply lose this grouping. Can't be undone.",
  couldNotDeleteCollection: 'Could not delete exhibition — try again',
  collectionDeletedToast: 'Exhibition deleted',
  collectionCoverAlt: 'Cover image for the “{title}” exhibition',
  collectionMetaDescFallback: 'A mini-exhibition curated by {name} on Weavo.',
  doneLabel: 'Done',
  publishBtn: 'Publish', unpublishBtn: 'Unpublish',
  statusPublished: 'Published', statusUnpublished: 'Unpublished',
  statusPublishedEndsOn: 'Published · ends {date}',
  statusUnpublishedEnded: 'Unpublished — ended {date}',
  endDateLabel: 'End date',
  publishedToast: 'Exhibition published', unpublishedToast: 'Exhibition unpublished',
  couldNotPublishCollection: 'Could not update — try again',
  addToExhibitionBtn: 'Add to Exhibition',
  newExhibitionTitlePlaceholder: 'New exhibition title…',
  createLabel: 'Create',
  selectDisabilitiesPlaceholder: 'Select disabilities…',
  cancelLabel: 'Cancel',
  reportBtnLabel: 'Report',
  reportAriaLabel_submission: 'Report this artwork',
  reportAriaLabel_comment: 'Report this comment',
  reportAriaLabel_profile: 'Report this account',
  reportTitle_submission: 'Report this artwork',
  reportTitle_comment: 'Report this comment',
  reportTitle_profile: 'Report this account',
  reportReasonLabel: 'Reason',
  reportReason_spam: 'Spam',
  reportReason_harassment: 'Harassment or bullying',
  reportReason_hate_speech: 'Hate speech',
  reportReason_nudity: 'Nudity or sexual content',
  reportReason_misinformation: 'Misinformation',
  reportReason_other: 'Other',
  reportDetailsLabel: 'Additional details',
  reportDetailsPlaceholder: 'Anything else moderators should know?',
  reportSubmitLabel: 'Submit report',
  reportSubmittedToast: "Report submitted — thank you.",
  alreadyReportedToast: "You've already reported this.",
  couldNotSubmitReport: 'Could not submit report. Try again.',
  blockLabel: 'Block',
  unblockLabel: 'Unblock',
  blockAriaLabel_submission: "Block this artwork's author",
  blockAriaLabel_comment: "Block this comment's author",
  unblockAriaLabel_submission: "Unblock this artwork's author",
  unblockAriaLabel_comment: "Unblock this comment's author",
  blockUserConfirmTitle: 'Block this user?',
  blockUserConfirmOkLabel: 'Block user',
  blockUserConfirmMessage: "Block this user? Their comments and artwork will no longer be visible to you, and they won't be able to comment on your artwork.",
  userBlockedToast: 'User blocked.',
  userUnblockedToast: 'User unblocked.',
  couldNotUpdateBlockUser: 'Could not update block. Try again.',
  blockedUsersTitle: 'Blocked users',
  adminLink: 'Admin', adminYou: 'you',
  adminLoadError: 'Could not load admin data',
  adminStatus_open: 'Open', adminStatus_resolved: 'Resolved', adminStatus_dismissed: 'Dismissed',
  adminMarkResolved: 'Mark resolved', adminMarkDismissed: 'Dismiss', adminReopen: 'Reopen',
  adminReportUpdated: 'Report updated', adminCouldNotUpdateReport: 'Could not update the report',
  adminTarget_submission: 'Artwork', adminTarget_comment: 'Comment', adminTarget_profile: 'Account',
  adminTargetMissing: '(target already deleted)', adminReportedBy: 'reported by {name}',
  adminCells: '{w} × {h} cells, {filled} filled', adminCreatedOn: 'created {date}',
  adminDeleteCampaignTitle: 'Delete this campaign?',
  adminDeleteCampaignMessage: "Its artworks are not deleted — they return to their artists' pools. This cannot be undone. Type the campaign title {title} to confirm.",
  adminCampaignDeleted: "Campaign deleted — its artworks are back in their artists' pools", adminCouldNotDeleteCampaign: 'Could not delete the campaign',
  adminSettingSaved: 'Option saved', adminSettingSaveFailed: 'Could not save the option',
  adminVisitsTip: '{date}: {total} visitors — {members} members, {guests} guests', adminVisitsChartLabel: 'Visitors per day for the last {n} days, members and guests',
  adminEditLabel: 'Edit', adminCampaignUpdated: 'Campaign updated', adminCouldNotUpdateCampaign: 'Could not update the campaign',
  adminGridImageBtn: 'Create grid image', adminGridImageWorking: 'Creating the grid image…', adminGridImageDone: 'Grid image created — campaign pages now read it from the cache', adminGridImageFailed: 'Could not create the grid image (nothing was changed)',
  adminGridImageYes: 'grid image ✓', adminGridImageNo: 'no grid image yet',
  adminPreviewImageBtn: 'Create share image', adminPreviewImageRedoBtn: 'Recreate share image', adminPreviewImageWorking: 'Creating the share image…', adminPreviewImageDone: 'Share image created', adminPreviewImageFailed: 'Could not create the share image',
  adminPreviewImageYes: 'share image ✓', adminPreviewImageNo: 'no share image (logo used)',
  adminPoolRunning: 'Placing pooled artworks…', adminPoolPlaced: '{n} piece(s) placed into campaigns', adminPoolNonePlaced: 'Nothing placed — no open cell in an active campaign matches these colors', adminPoolFailed: 'Could not run the placement',
  adminThumbsWorking: 'Rebuilding thumbnails… {done}/{total}', adminThumbsDone: 'Thumbnails made for {n} artwork(s)', adminThumbsFailed: '{done} done, {failed} failed (see console)',
  adminPiecesWorking: 'Cutting pieces… {done}/{total}', adminPiecesDone: 'Pieces cut for {n} artwork(s)', adminPiecesFailed: '{done} done, {failed} failed (see console)',
  adminPiecesRegenTitle: 'Recut every artwork', adminPiecesRegenLabel: 'Recut', adminPiecesRegenConfirm: 'Every artwork is cut again at the current piece grid. All placed pieces are released and matched again. Continue?',
  mfsClose: 'Close',
  mfsExpand: 'View fullscreen',
  editArtworkBtn: 'Edit',
  editArtworkTitle: 'Edit artwork details',
  artTitleLabel: 'Title', artTitlePlaceholder: 'Untitled',
  artMaterialLabel: 'Material', artMaterialPlaceholder: 'e.g. Oil on canvas',
  artCompletedLabel: 'Year completed', artYearPlaceholder: 'e.g. 2020',
  artCompletedYearInvalid: 'Enter a year between {min} and {max}.',
  artStatementLabel: 'Artist statement', artStatementPlaceholder: "What's the story behind this piece?",
  artLinkLabel: 'Link to more of your work',
  saveLabel: 'Save',
  artworkUpdatedToast: 'Artwork updated',
  couldNotUpdateArtwork: 'Could not update artwork — try again',
  linkCopied: 'Link copied',
};

function tr(key, vars) {
  let s = T[key] ?? key;
  if (vars) for (const k in vars) s = s.split(`{${k}}`).join(vars[k]);
  return s;
}

// Display labels for DISABILITY_GROUPS/DISABILITY_KEYS (see js/common.js).
const DISABILITY_GROUP_LABELS = {
  physical: 'Physical & Mobility',
  vision: 'Vision',
  hearing: 'Hearing',
  neurodivergent_learning: 'Neurodivergence & Learning',
  mental_health: 'Mental Health',
  chronic_health: 'Chronic Health',
  speech_communication: 'Speech & Communication',
  other: 'Other',
};
const DISABILITY_LABELS = {
  no_disability: 'No disability',
  mobility: 'Mobility disability (e.g. wheelchair or mobility aid user)',
  dexterity: 'Dexterity / fine motor disability',
  limb_difference: 'Limb difference',
  blind: 'Blind',
  low_vision: 'Low vision',
  color_blindness: 'Color blindness',
  deaf: 'Deaf',
  hard_of_hearing: 'Hard of hearing',
  adhd: 'ADHD',
  autism: 'Autism spectrum',
  learning_disability: 'Dyslexia or other learning disability',
  tourettes_tic: "Tourette's or tic disorder",
  intellectual_developmental: 'Intellectual or developmental disability',
  anxiety: 'Anxiety disorder',
  depression: 'Depression',
  mental_health_other: 'Other mental health condition',
  chronic_illness: 'Chronic illness',
  chronic_pain: 'Chronic pain',
  fatigue_condition: 'Long-term fatigue (e.g. ME/CFS, long COVID)',
  speech: 'Speech disability',
  nonverbal_communication: 'Non-verbal / augmentative communication (AAC)',
  other: 'Other disability',
  prefer_not_to_say: 'Prefer not to say',
};
function disabilityLabel(key) { return DISABILITY_LABELS[key] || key; }
function disabilityGroupLabel(key) { return DISABILITY_GROUP_LABELS[key] || key; }
function fmtJoined(dateStr) {
  const d = new Date(dateStr);
  return `Joined ${d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`;
}
function fmtShortDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
// art_completed_date is a plain date (YYYY-MM-DD, no time/zone) — built from
// its y/m/d parts directly rather than `new Date(dateStr)`, which parses a
// bare date string as UTC midnight and can print a day early in any
// negative-UTC-offset timezone.
function fmtCompletedDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}
// Artwork's "year completed" — stored as YYYY-01-01 (see artDateToYear in
// common.js), shown as just the year.
function fmtCompletedYear(dateStr) {
  return String(dateStr).slice(0, 4);
}
function pieceContributedText(n) {
  return `${n} piece${n !== 1 ? 's' : ''} contributed`;
}
function filledText(filled, total) {
  return `${filled} / ${total} filled`;
}
function openCellTooltip(c) {
  return `rgb(${c.r}, ${c.g}, ${c.b}) — ${c.count} open cell${c.count !== 1 ? 's' : ''}`;
}
function moreCellsTooltip(remainder) {
  return `${remainder} more open cell${remainder !== 1 ? 's' : ''} in other shades`;
}
function projectCreatedToast(skipped) {
  if (!skipped) return tr('projectCreated');
  return `Campaign created! (${skipped} transparent cell${skipped !== 1 ? 's' : ''} excluded)`;
}
function collectionItemCountText(n) {
  return `${n} piece${n !== 1 ? 's' : ''}`;
}

// ISO 3166-1 numeric → country name, same ids main.html's world map uses
// for country_id, so a profile's country stays consistent with any
// map/flag lookups elsewhere in the app.
const COUNTRY_NAMES = {
  4:"Afghanistan",8:"Albania",12:"Algeria",24:"Angola",32:"Argentina",
  36:"Australia",40:"Austria",50:"Bangladesh",56:"Belgium",64:"Bhutan",
  68:"Bolivia",76:"Brazil",100:"Bulgaria",104:"Myanmar",116:"Cambodia",
  120:"Cameroon",124:"Canada",140:"Central African Republic",144:"Sri Lanka",
  152:"Chile",156:"China",170:"Colombia",178:"Congo",180:"DR Congo",
  188:"Costa Rica",191:"Croatia",192:"Cuba",196:"Cyprus",203:"Czechia",
  208:"Denmark",218:"Ecuador",818:"Egypt",222:"El Salvador",231:"Ethiopia",
  246:"Finland",250:"France",266:"Gabon",276:"Germany",288:"Ghana",
  300:"Greece",320:"Guatemala",324:"Guinea",332:"Haiti",340:"Honduras",
  348:"Hungary",352:"Iceland",356:"India",360:"Indonesia",364:"Iran",
  368:"Iraq",372:"Ireland",376:"Israel",380:"Italy",388:"Jamaica",
  392:"Japan",400:"Jordan",398:"Kazakhstan",404:"Kenya",410:"South Korea",
  408:"North Korea",414:"Kuwait",418:"Laos",422:"Lebanon",430:"Liberia",
  434:"Libya",440:"Lithuania",442:"Luxembourg",450:"Madagascar",
  454:"Malawi",458:"Malaysia",462:"Maldives",466:"Mali",484:"Mexico",
  496:"Mongolia",504:"Morocco",508:"Mozambique",516:"Namibia",524:"Nepal",
  528:"Netherlands",554:"New Zealand",558:"Nicaragua",566:"Nigeria",
  578:"Norway",512:"Oman",586:"Pakistan",591:"Panama",598:"Papua New Guinea",
  600:"Paraguay",604:"Peru",608:"Philippines",616:"Poland",620:"Portugal",
  634:"Qatar",642:"Romania",643:"Russia",646:"Rwanda",682:"Saudi Arabia",
  686:"Senegal",694:"Sierra Leone",703:"Slovakia",705:"Slovenia",
  706:"Somalia",710:"South Africa",728:"South Sudan",724:"Spain",
  729:"Sudan",752:"Sweden",756:"Switzerland",760:"Syria",158:"Taiwan",
  762:"Tajikistan",764:"Thailand",768:"Togo",788:"Tunisia",792:"Turkey",
  800:"Uganda",804:"Ukraine",784:"United Arab Emirates",826:"United Kingdom",
  840:"United States",858:"Uruguay",860:"Uzbekistan",862:"Venezuela",
  704:"Vietnam",887:"Yemen",894:"Zambia",716:"Zimbabwe",44:"Bahamas",
  48:"Bahrain",84:"Belize",204:"Benin",72:"Botswana",96:"Brunei",
  854:"Burkina Faso",108:"Burundi",132:"Cape Verde",214:"Dominican Republic",
  384:"Ivory Coast",242:"Fiji",270:"Gambia",478:"Mauritania",480:"Mauritius",
  562:"Niger",31:"Azerbaijan",51:"Armenia",90:"Solomon Islands",
  112:"Belarus",174:"Comoros",226:"Equatorial Guinea",232:"Eritrea",
  262:"Djibouti",268:"Georgia",275:"Palestine",328:"Guyana",
  417:"Kyrgyzstan",426:"Lesotho",498:"Moldova",
  499:"Montenegro",534:"Sint Maarten",540:"New Caledonia",548:"Vanuatu",
  626:"Timor-Leste",674:"San Marino",688:"Serbia",
  732:"Western Sahara",740:"Suriname",780:"Trinidad and Tobago",
  795:"Turkmenistan",807:"North Macedonia"
};
function countryName(id) { return COUNTRY_NAMES[id] || ''; }
