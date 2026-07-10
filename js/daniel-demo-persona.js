(function () {
  const DANIEL_DEMO_ANSWERS = {
    "L1_A1_Q1": { "option": 4, "confidence": 4, "value": 0.75, "axisId": "L1_A1", "layerId": "L1" },
    "L1_A1_Q2": { "option": 3, "confidence": 4, "value": 0.5, "axisId": "L1_A1", "layerId": "L1" },
    "L1_A1_Q3": { "option": 4, "confidence": 4, "value": 0.75, "axisId": "L1_A1", "layerId": "L1" },
    "L1_A2_Q1": { "option": 4, "confidence": 4, "value": 0.75, "axisId": "L1_A2", "layerId": "L1" },
    "L1_A2_Q2": { "option": 4, "confidence": 4, "value": 0.75, "axisId": "L1_A2", "layerId": "L1" },
    "L1_A2_Q3": { "option": 4, "confidence": 4, "value": 0.75, "axisId": "L1_A2", "layerId": "L1" },
    "L1_A3_Q1": { "option": 2, "confidence": 4, "value": 0.25, "axisId": "L1_A3", "layerId": "L1" },
    "L1_A3_Q2": { "option": 3, "confidence": 4, "value": 0.5, "axisId": "L1_A3", "layerId": "L1" },
    "L1_A3_Q3": { "option": 2, "confidence": 4, "value": 0.25, "axisId": "L1_A3", "layerId": "L1" },
    "L1_A4_Q1": { "option": 2, "confidence": 4, "value": 0.25, "axisId": "L1_A4", "layerId": "L1" },
    "L1_A4_Q2": { "option": 3, "confidence": 4, "value": 0.5, "axisId": "L1_A4", "layerId": "L1" },
    "L1_A4_Q3": { "option": 2, "confidence": 4, "value": 0.25, "axisId": "L1_A4", "layerId": "L1" },
    "L1_A5_Q1": { "option": 2, "confidence": 4, "value": 0.25, "axisId": "L1_A5", "layerId": "L1" },
    "L1_A5_Q2": { "option": 3, "confidence": 4, "value": 0.5, "axisId": "L1_A5", "layerId": "L1" },
    "L1_A5_Q3": { "option": 2, "confidence": 4, "value": 0.25, "axisId": "L1_A5", "layerId": "L1" },
    "L1_A6_Q1": { "option": 3, "confidence": 4, "value": 0.5, "axisId": "L1_A6", "layerId": "L1" },
    "L1_A6_Q2": { "option": 4, "confidence": 4, "value": 0.75, "axisId": "L1_A6", "layerId": "L1" },
    "L1_A6_Q3": { "option": 3, "confidence": 4, "value": 0.5, "axisId": "L1_A6", "layerId": "L1" },
    "L2_A1_Q1": { "option": 3, "confidence": 4, "value": 0.5, "axisId": "L2_A1", "layerId": "L2" },
    "L2_A1_Q2": { "option": 4, "confidence": 4, "value": 0.75, "axisId": "L2_A1", "layerId": "L2" },
    "L2_A1_Q3": { "option": 3, "confidence": 4, "value": 0.5, "axisId": "L2_A1", "layerId": "L2" },
    "L2_A2_Q1": { "option": 3, "confidence": 4, "value": 0.5, "axisId": "L2_A2", "layerId": "L2" },
    "L2_A2_Q2": { "option": 4, "confidence": 4, "value": 0.75, "axisId": "L2_A2", "layerId": "L2" },
    "L2_A2_Q3": { "option": 3, "confidence": 4, "value": 0.5, "axisId": "L2_A2", "layerId": "L2" },
    "L2_A3_Q1": { "option": 4, "confidence": 4, "value": 0.75, "axisId": "L2_A3", "layerId": "L2" },
    "L2_A3_Q2": { "option": 4, "confidence": 4, "value": 0.75, "axisId": "L2_A3", "layerId": "L2" },
    "L2_A3_Q3": { "option": 3, "confidence": 4, "value": 0.5, "axisId": "L2_A3", "layerId": "L2" },
    "L2_A4_Q1": { "option": 2, "confidence": 4, "value": 0.25, "axisId": "L2_A4", "layerId": "L2" },
    "L2_A4_Q2": { "option": 2, "confidence": 4, "value": 0.25, "axisId": "L2_A4", "layerId": "L2" },
    "L2_A4_Q3": { "option": 3, "confidence": 4, "value": 0.5, "axisId": "L2_A4", "layerId": "L2" },
    "L2_A5_Q1": { "option": 3, "confidence": 4, "value": 0.5, "axisId": "L2_A5", "layerId": "L2" },
    "L2_A5_Q2": { "option": 4, "confidence": 4, "value": 0.75, "axisId": "L2_A5", "layerId": "L2" },
    "L2_A5_Q3": { "option": 3, "confidence": 4, "value": 0.5, "axisId": "L2_A5", "layerId": "L2" },
    "L2_A6_Q1": { "option": 4, "confidence": 4, "value": 0.75, "axisId": "L2_A6", "layerId": "L2" },
    "L2_A6_Q2": { "option": 4, "confidence": 4, "value": 0.75, "axisId": "L2_A6", "layerId": "L2" },
    "L2_A6_Q3": { "option": 4, "confidence": 4, "value": 0.75, "axisId": "L2_A6", "layerId": "L2" },
    "L3_A1_Q1": { "option": 4, "confidence": 5, "value": 0.75, "axisId": "L3_A1", "layerId": "L3" },
    "L3_A1_Q2": { "option": 4, "confidence": 5, "value": 0.75, "axisId": "L3_A1", "layerId": "L3" },
    "L3_A1_Q3": { "option": 5, "confidence": 5, "value": 1, "axisId": "L3_A1", "layerId": "L3" },
    "L3_A2_Q1": { "option": 4, "confidence": 5, "value": 0.75, "axisId": "L3_A2", "layerId": "L3" },
    "L3_A2_Q2": { "option": 5, "confidence": 5, "value": 1, "axisId": "L3_A2", "layerId": "L3" },
    "L3_A2_Q3": { "option": 5, "confidence": 5, "value": 1, "axisId": "L3_A2", "layerId": "L3" },
    "L3_A3_Q1": { "option": 4, "confidence": 5, "value": 0.75, "axisId": "L3_A3", "layerId": "L3" },
    "L3_A3_Q2": { "option": 4, "confidence": 5, "value": 0.75, "axisId": "L3_A3", "layerId": "L3" },
    "L3_A3_Q3": { "option": 4, "confidence": 5, "value": 0.75, "axisId": "L3_A3", "layerId": "L3" },
    "L3_A4_Q1": { "option": 4, "confidence": 5, "value": 0.75, "axisId": "L3_A4", "layerId": "L3" },
    "L3_A4_Q2": { "option": 4, "confidence": 5, "value": 0.75, "axisId": "L3_A4", "layerId": "L3" },
    "L3_A4_Q3": { "option": 3, "confidence": 5, "value": 0.5, "axisId": "L3_A4", "layerId": "L3" },
    "L3_A5_Q1": { "option": 4, "confidence": 5, "value": 0.75, "axisId": "L3_A5", "layerId": "L3" },
    "L3_A5_Q2": { "option": 4, "confidence": 5, "value": 0.75, "axisId": "L3_A5", "layerId": "L3" },
    "L3_A5_Q3": { "option": 4, "confidence": 5, "value": 0.75, "axisId": "L3_A5", "layerId": "L3" },
    "L3_A6_Q1": { "option": 3, "confidence": 5, "value": 0.5, "axisId": "L3_A6", "layerId": "L3" },
    "L3_A6_Q2": { "option": 3, "confidence": 5, "value": 0.5, "axisId": "L3_A6", "layerId": "L3" },
    "L3_A6_Q3": { "option": 2, "confidence": 5, "value": 0.25, "axisId": "L3_A6", "layerId": "L3" },
    "L4_A1_Q1": { "type": "multi", "selected": ["Witty", "Lighthearted", "Reserved"], "axisId": "L4_A1", "layerId": "L4" },
    "L4_A1_Q2": { "type": "multi", "selected": ["Relaxed", "Lighthearted", "Quiet"], "axisId": "L4_A1", "layerId": "L4" },
    "L4_A1_Q3": { "type": "multi", "selected": ["Witty", "Entertaining", "Calm"], "axisId": "L4_A1", "layerId": "L4" },
    "L4_A2_Q1": { "type": "multi", "selected": ["Warm", "Approachable", "Open"], "axisId": "L4_A2", "layerId": "L4" },
    "L4_A2_Q2": { "type": "multi", "selected": ["Caring", "Understanding", "Gentle"], "axisId": "L4_A2", "layerId": "L4" },
    "L4_A2_Q3": { "type": "multi", "selected": ["Friendly", "Warm", "Relaxed"], "axisId": "L4_A2", "layerId": "L4" },
    "L4_A3_Q1": { "type": "multi", "selected": ["Honest", "Careful", "Diplomatic"], "axisId": "L4_A3", "layerId": "L4" },
    "L4_A3_Q2": { "type": "multi", "selected": ["Clear", "Careful", "Polite"], "axisId": "L4_A3", "layerId": "L4" },
    "L4_A3_Q3": { "type": "multi", "selected": ["Honest", "Gentle", "Careful"], "axisId": "L4_A3", "layerId": "L4" },
    "L4_A4_Q1": { "type": "multi", "selected": ["Calm", "Steady", "Low-key"], "axisId": "L4_A4", "layerId": "L4" },
    "L4_A4_Q2": { "type": "multi", "selected": ["Relaxed", "Engaging", "Steady"], "axisId": "L4_A4", "layerId": "L4" },
    "L4_A4_Q3": { "type": "multi", "selected": ["Calm", "Grounded", "Alert"], "axisId": "L4_A4", "layerId": "L4" },
    "L4_A5_Q1": { "type": "multi", "selected": ["Composed", "Open", "Subtle"], "axisId": "L4_A5", "layerId": "L4" },
    "L4_A5_Q2": { "type": "multi", "selected": ["Composed", "Reserved", "Quiet"], "axisId": "L4_A5", "layerId": "L4" },
    "L4_A5_Q3": { "type": "multi", "selected": ["Composed", "Reserved", "Guarded"], "axisId": "L4_A5", "layerId": "L4" },
    "L4_A6_Q1": { "type": "multi", "selected": ["Casual", "Easygoing", "Reserved"], "axisId": "L4_A6", "layerId": "L4" },
    "L4_A6_Q2": { "type": "multi", "selected": ["Friendly", "Polite", "Relaxed"], "axisId": "L4_A6", "layerId": "L4" },
    "L4_A6_Q3": { "type": "multi", "selected": ["Professional", "Polished", "Proper"], "axisId": "L4_A6", "layerId": "L4" },
    "L5_S1_F1": { "type": "free", "text": "Black American.", "sectionId": "L5_S1", "layerId": "L5", "fieldName": "race" },
    "L5_S1_F2": { "type": "free", "text": "English primarily, with some conversational Spanish.", "sectionId": "L5_S1", "layerId": "L5", "fieldName": "languages" },
    "L5_S1_F3": { "type": "free", "text": "Not strongly religious from what Maya knows, but respectful of other people's beliefs.", "sectionId": "L5_S1", "layerId": "L5", "fieldName": "religion" },
    "L5_S2_F1": { "type": "free", "text": "Graduate student in product design with part-time freelance UX work.", "sectionId": "L5_S2", "layerId": "L5", "fieldName": "current_status" },
    "L5_S2_F2": { "type": "free", "text": "San Francisco State University graduate program.", "sectionId": "L5_S2", "layerId": "L5", "fieldName": "school_university" },
    "L5_S2_F3": { "type": "free", "text": "He wants to build thoughtful consumer products and eventually lead design at a mission-driven company.", "sectionId": "L5_S2", "layerId": "L5", "fieldName": "aspirations" },
    "L5_S3_F1": { "type": "free", "text": "Campus project teams, design studios, quiet cafes, the climbing gym, and a close Bay Area friend circle.", "sectionId": "L5_S3", "layerId": "L5", "fieldName": "communities" },
    "L5_S3_F2": { "type": "free", "text": "Mostly one-on-one hangouts, small dinners, and planned meetups rather than loud parties.", "sectionId": "L5_S3", "layerId": "L5", "fieldName": "environment_style" },
    "L5_S4_F1": { "type": "free", "text": "Basketball, climbing, design research, playlists, and weekend cafe hopping.", "sectionId": "L5_S4", "layerId": "L5", "fieldName": "hobbies" },
    "L5_S4_F2": { "type": "free", "text": "Fairly invested. His hobbies look like a real part of his weekly routine.", "sectionId": "L5_S4", "layerId": "L5", "fieldName": "engagement_level" },
    "L5_S5_F1": { "type": "free", "text": "R&B, mellow hip-hop, indie pop, Afrobeats, and thoughtful singer-songwriter playlists.", "sectionId": "L5_S5", "layerId": "L5", "fieldName": "music" },
    "L5_S5_F2": { "type": "free", "text": "Character-driven dramas, smart comedies, design documentaries, and relationship-centered films.", "sectionId": "L5_S5", "layerId": "L5", "fieldName": "shows_movies" },
    "L5_S5_F3": { "type": "free", "text": "Occasional FIFA, social party games, and the occasional strategy board game.", "sectionId": "L5_S5", "layerId": "L5", "fieldName": "games" },
    "L5_S5_F4": { "type": "free", "text": "Clean, minimal, practical, slightly curated, with neutral tones and good sneakers.", "sectionId": "L5_S5", "layerId": "L5", "fieldName": "aesthetic_style" },
    "L6_S1_F1": { "type": "free", "text": "No major physical limitations known.", "sectionId": "L6_S1", "layerId": "L6", "fieldName": "physical_incapability" },
    "L6_S1_F2": { "type": "free", "text": "Reckless dares, humiliating public stunts, and chaotic late-night social scenes.", "sectionId": "L6_S1", "layerId": "L6", "fieldName": "hard_no_activities" },
    "L6_S1_F3": { "type": "free", "text": "He does not respond well to emotional ultimatums, public embarrassment, or being pressured into labels on the spot.", "sectionId": "L6_S1", "layerId": "L6", "fieldName": "absolute_boundaries" },
    "L6_S2_F1": { "type": "free", "text": "Good pasta, Korean barbecue, sushi, and strong coffee desserts.", "sectionId": "L6_S2", "layerId": "L6", "fieldName": "favorite_dishes" },
    "L6_S2_F2": { "type": "free", "text": "Earth tones, forest green, charcoal, and navy.", "sectionId": "L6_S2", "layerId": "L6", "fieldName": "favorite_colors" },
    "L6_S2_F3": { "type": "free", "text": "Coffee walks, design exhibits, bookstore browsing, dinner in quiet places, and low-key weekend trips.", "sectionId": "L6_S2", "layerId": "L6", "fieldName": "preferred_activities" },
    "L6_S3_F1": { "type": "free", "text": "Crowded clubs, flaky planning, condescending people, forced vulnerability, and performative drama.", "sectionId": "L6_S3", "layerId": "L6", "fieldName": "extreme_dislikes" },
    "L6_S3_F2": { "type": "free", "text": "Warm sincerity, clear invitations, thoughtful follow-through, relaxed humor, and good taste.", "sectionId": "L6_S3", "layerId": "L6", "fieldName": "strong_likes" },
    "extra_time_life": { "type": "free", "text": "Grad school, freelance work, and a relationship that is becoming more intentional are all happening at once.", "layerId": "EXTRA", "fieldName": "extra_time_life" },
    "extra_current_context": { "type": "free", "text": "He is balancing deadlines while sensing that the relationship may need a more explicit conversation soon.", "layerId": "EXTRA", "fieldName": "extra_current_context" },
    "extra_stressors": { "type": "free", "text": "School deadlines, money management, and uncertainty about whether the timing is right to define the relationship.", "layerId": "EXTRA", "fieldName": "extra_stressors" },
    "extra_cultural_moment": { "type": "free", "text": "He moves in ambitious Bay Area circles that value independence, but he still respects direct and considerate communication.", "layerId": "EXTRA", "fieldName": "extra_cultural_moment" },
    "extra_relationship_role": { "type": "free", "text": "Romantic interest the user is trying to understand and approach with care.", "layerId": "EXTRA", "fieldName": "extra_relationship_role" }
  };

  const DANIEL_DEMO_EXTRAS = {
    "basic-profile": "Daniel Smith. Male. 23 yrs old. Graduate student in product design living in the Bay Area.",
    "relationship-role": "Romantic interest and close relationship focus for Maya Chen.",
    "time-life": "23-year-old graduate student in product design, balancing academic deadlines, freelance work, and early adult relationship decisions.",
    "current-context": "Maya and Daniel have been spending more intentional time together. The relationship feels promising, but neither person has clearly named where it is going yet.",
    "communication-pattern": "Responds well to warmth, sincerity, and specific invitations. He can become reserved when the tone feels like an urgent decision must be made immediately.",
    "emotional-needs": "Needs room to think, a sense that his answer is welcome either way, and a conversation that feels mutual rather than like a test.",
    "stressors": "Academic deadlines, part-time project work, and uncertainty about whether defining the relationship too quickly could change the easy trust he and Maya have built.",
    "cultural-moment": "Moves in ambitious Bay Area student and design circles where independence matters, but sincere one-on-one communication still carries weight.",
    "decision-context": "Best Way should weigh clarity against pressure and prefer messages that invite honest conversation without cornering either person."
  };

  const MAYA_DEMO_EXTRAS = {
    "basic-profile": "Maya Chen. Female. 22 yrs old. Undergraduate student in San Francisco.",
    "relationship-role": "Account-level user context and relationship decision maker in the Daniel Smith demo.",
    "time-life": "22-year-old student navigating school pressure, creative work, and a relationship moment that requires one careful real-world action.",
    "current-context": "Maya wants to invite Daniel into a clearer conversation without making the message feel heavy, rushed, or emotionally demanding.",
    "communication-pattern": "Communicates best through warm specificity, plain language, and a tone that leaves the other person room to answer honestly.",
    "emotional-needs": "Needs clarity, mutual respect, and enough emotional steadiness to avoid turning uncertainty into pressure.",
    "stressors": "Academic workload, uncertainty about Daniel's timing, and concern that one poorly framed message could make a promising connection feel tense.",
    "cultural-moment": "Lives in a socially active student environment where casual ambiguity is common, but she is trying to choose a more considerate and direct path.",
    "decision-context": "Best Way should help Maya balance directness with care, making the next message easy to understand and safe for Daniel to receive."
  };

  const AARON_DEMO_EXTRAS = {
    "basic-profile": "Aaron Chen. Male. 55 yrs old. Maya Chen's father, based in the Bay Area.",
    "relationship-role": "Family persona and father figure Maya wants to approach with care during important life updates.",
    "time-life": "55-year-old operations manager and family anchor who balances work, household responsibilities, and deep concern for Maya's future.",
    "current-context": "Aaron wants Maya to feel supported, but he reacts best when big news is shared privately, calmly, and with enough context to understand the next step.",
    "communication-pattern": "Responds well to respectful honesty, practical planning, and warm reassurance. He can become worried or directive when news arrives suddenly or without a plan.",
    "emotional-needs": "Needs to know Maya is safe, thinking clearly, and not carrying a difficult decision alone. He wants to be included as a loving father, not managed from a distance.",
    "stressors": "Family financial stability, Maya's school path, health and safety concerns, and fear that she may hide difficult feelings until they become urgent.",
    "cultural-moment": "Carries a family-first mindset shaped by immigrant-parent responsibility, practical sacrifice, and quiet affection more than dramatic emotional display.",
    "decision-context": "Best Way should help Maya share family news with warmth, respect, and a concrete next step so Aaron can respond with care instead of panic."
  };

  const NAOMI_DEMO_EXTRAS = {
    "basic-profile": "Naomi Brooks. Female. 39 yrs old. Maya Chen's manager and team lead.",
    "relationship-role": "Workplace persona and professional decision maker Maya wants to approach with clarity and respect.",
    "time-life": "Experienced strategy lead balancing team delivery, client expectations, budget limits, and employee development.",
    "current-context": "Naomi manages a busy team where Maya wants to handle compensation, accountability, and time-off requests in a responsible way.",
    "communication-pattern": "Responds well to concise preparation, direct ownership, measurable examples, and requests that acknowledge team impact.",
    "emotional-needs": "Needs to know Maya understands business constraints, owns her responsibilities, and is asking for a concrete next step rather than vague reassurance.",
    "stressors": "Client timelines, staffing coverage, budget cycles, report quality, and maintaining trust across a fast-moving team.",
    "cultural-moment": "Works in a professional culture that values psychological safety, but also expects accountability, evidence, and practical follow-through.",
    "decision-context": "Best Way should help Maya communicate with professionalism: specific ask, clear context, team-aware tradeoffs, and a respectful tone."
  };

  DANIEL_DEMO_EXTRAS.conclusion = 'Daniel is a warm, steady, design-oriented graduate student who responds best to sincerity that gives him room to think. His strongest signals are respect, honesty, and depth; rushed emotional certainty can make him withdraw even when he cares. Best Way should favor clear invitations with low pressure, practical timing, and space for Daniel to answer without feeling cornered.';
  MAYA_DEMO_EXTRAS.conclusion = 'Maya is a thoughtful 22-year-old student who notices tone, timing, and emotional detail before making a move. She wants clarity and sincerity, but her best decisions happen when she slows down enough to separate care from urgency. Best Way should help Maya communicate directly while keeping the message warm, respectful, and easy for the other person to answer honestly.';
  AARON_DEMO_EXTRAS.conclusion = 'Aaron is a protective, practical, and deeply caring father who responds best when Maya gives him honest context and a clear next step. His strongest signals are family loyalty, responsibility, steadiness, and quiet warmth; surprise without explanation can make him worry before he understands the full picture. Best Way should help Maya speak with love and preparation so Aaron can feel included, respected, and ready to support her.';
  NAOMI_DEMO_EXTRAS.conclusion = 'Naomi is a fair, direct, and deadline-aware team lead who responds best when Maya brings clarity, evidence, and a practical plan. Her strongest signals are accountability, preparation, and team impact; vague requests or delayed disclosure can make her focus on risk before support. Best Way should help Maya make workplace conversations specific, respectful, and easy for Naomi to evaluate.';

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function valueToOption(value) {
    return Math.max(1, Math.min(5, Math.round(Number(value || 0) * 4) + 1));
  }

  function buildMayaDemoAnswers() {
    const answers = clone(DANIEL_DEMO_ANSWERS);
    const axisBlueprint = {
      L1_A1: [0.5, 0.5, 0.75],
      L1_A2: [0.75, 0.75, 0.75],
      L1_A3: [0.25, 0.5, 0.25],
      L1_A4: [0.25, 0.5, 0.25],
      L1_A5: [0.5, 0.75, 0.5],
      L1_A6: [0.5, 0.5, 0.75],
      L2_A1: [0.5, 0.5, 0.75],
      L2_A2: [0.75, 0.75, 0.5],
      L2_A3: [0.75, 0.75, 0.75],
      L2_A4: [0.5, 0.75, 0.5],
      L2_A5: [0.5, 0.75, 0.75],
      L2_A6: [0.75, 0.75, 0.5],
      L3_A1: [0.75, 1, 0.75],
      L3_A2: [1, 1, 0.75],
      L3_A3: [0.75, 0.75, 0.75],
      L3_A4: [0.5, 0.75, 0.5],
      L3_A5: [0.75, 0.75, 1],
      L3_A6: [0.75, 0.75, 0.75]
    };

    Object.entries(answers).forEach(([questionId, answer]) => {
      if (!answer || typeof answer !== 'object' || typeof answer.value !== 'number' || !answer.axisId) return;
      const blueprint = axisBlueprint[answer.axisId];
      if (!blueprint) return;
      const qIndex = Math.max(0, Math.min(2, Number((questionId.match(/_Q(\d+)$/) || [])[1] || 1) - 1));
      const value = blueprint[qIndex];
      answer.type = 'choice';
      answer.value = value;
      answer.option = valueToOption(value);
      answer.confidence = answer.layerId === 'L3' ? 5 : 4;
    });

    Object.assign(answers, {
      "L4_A1_Q1": { "type": "multi", "selected": ["Warm", "Thoughtful", "Lighthearted"], "axisId": "L4_A1", "layerId": "L4" },
      "L4_A1_Q2": { "type": "multi", "selected": ["Calm", "Gentle", "Attentive"], "axisId": "L4_A1", "layerId": "L4" },
      "L4_A1_Q3": { "type": "multi", "selected": ["Reflective", "Friendly", "Low-pressure"], "axisId": "L4_A1", "layerId": "L4" },
      "L4_A2_Q1": { "type": "multi", "selected": ["Caring", "Open", "Patient"], "axisId": "L4_A2", "layerId": "L4" },
      "L4_A2_Q2": { "type": "multi", "selected": ["Understanding", "Sincere", "Supportive"], "axisId": "L4_A2", "layerId": "L4" },
      "L4_A2_Q3": { "type": "multi", "selected": ["Warm", "Respectful", "Steady"], "axisId": "L4_A2", "layerId": "L4" },
      "L4_A3_Q1": { "type": "multi", "selected": ["Honest", "Careful", "Direct"], "axisId": "L4_A3", "layerId": "L4" },
      "L4_A3_Q2": { "type": "multi", "selected": ["Clear", "Kind", "Specific"], "axisId": "L4_A3", "layerId": "L4" },
      "L4_A3_Q3": { "type": "multi", "selected": ["Diplomatic", "Gentle", "Intentional"], "axisId": "L4_A3", "layerId": "L4" },
      "L4_A4_Q1": { "type": "multi", "selected": ["Composed", "Soft-spoken", "Grounded"], "axisId": "L4_A4", "layerId": "L4" },
      "L4_A4_Q2": { "type": "multi", "selected": ["Present", "Engaged", "Warm"], "axisId": "L4_A4", "layerId": "L4" },
      "L4_A4_Q3": { "type": "multi", "selected": ["Calm", "Attentive", "Measured"], "axisId": "L4_A4", "layerId": "L4" },
      "L4_A5_Q1": { "type": "multi", "selected": ["Composed", "Tender", "Observant"], "axisId": "L4_A5", "layerId": "L4" },
      "L4_A5_Q2": { "type": "multi", "selected": ["Reserved", "Thoughtful", "Careful"], "axisId": "L4_A5", "layerId": "L4" },
      "L4_A5_Q3": { "type": "multi", "selected": ["Vulnerable", "Measured", "Respectful"], "axisId": "L4_A5", "layerId": "L4" },
      "L4_A6_Q1": { "type": "multi", "selected": ["Simple", "Natural", "Gentle"], "axisId": "L4_A6", "layerId": "L4" },
      "L4_A6_Q2": { "type": "multi", "selected": ["Friendly", "Polite", "Open"], "axisId": "L4_A6", "layerId": "L4" },
      "L4_A6_Q3": { "type": "multi", "selected": ["Clear", "Warm", "Mature"], "axisId": "L4_A6", "layerId": "L4" },
      "L5_S1_F1": { "type": "free", "text": "Asian American, Chinese-Vietnamese family background.", "sectionId": "L5_S1", "layerId": "L5", "fieldName": "race" },
      "L5_S1_F2": { "type": "free", "text": "English primarily, with conversational Vietnamese at home.", "sectionId": "L5_S1", "layerId": "L5", "fieldName": "languages" },
      "L5_S1_F3": { "type": "free", "text": "Not strongly religious, but respectful of family traditions and reflective values.", "sectionId": "L5_S1", "layerId": "L5", "fieldName": "religion" },
      "L5_S2_F1": { "type": "free", "text": "Undergraduate student with a creative strategy internship and campus project work.", "sectionId": "L5_S2", "layerId": "L5", "fieldName": "current_status" },
      "L5_S2_F2": { "type": "free", "text": "San Francisco State University.", "sectionId": "L5_S2", "layerId": "L5", "fieldName": "school_university" },
      "L5_S2_F3": { "type": "free", "text": "She wants to build emotionally intelligent products and become confident making hard interpersonal decisions.", "sectionId": "L5_S2", "layerId": "L5", "fieldName": "aspirations" },
      "L5_S3_F1": { "type": "free", "text": "Campus friends, creative clubs, quiet study groups, and a small circle of close confidants.", "sectionId": "L5_S3", "layerId": "L5", "fieldName": "communities" },
      "L5_S3_F2": { "type": "free", "text": "Prefers small group dinners, walks, cafes, and relaxed settings where conversations can unfold naturally.", "sectionId": "L5_S3", "layerId": "L5", "fieldName": "environment_style" },
      "L5_S4_F1": { "type": "free", "text": "Photography, journaling, design moodboards, playlists, coffee walks, and campus events.", "sectionId": "L5_S4", "layerId": "L5", "fieldName": "hobbies" },
      "L5_S4_F2": { "type": "free", "text": "Very invested when the activity helps her process feelings, build taste, or connect with people she trusts.", "sectionId": "L5_S4", "layerId": "L5", "fieldName": "engagement_level" },
      "L5_S5_F1": { "type": "free", "text": "Indie pop, soft R&B, acoustic playlists, and reflective late-night music.", "sectionId": "L5_S5", "layerId": "L5", "fieldName": "music" },
      "L5_S5_F2": { "type": "free", "text": "Character-driven dramas, gentle romantic films, smart comedies, and visual design documentaries.", "sectionId": "L5_S5", "layerId": "L5", "fieldName": "shows_movies" },
      "L5_S5_F3": { "type": "free", "text": "Cozy puzzle games, social party games with close friends, and occasional mobile games during study breaks.", "sectionId": "L5_S5", "layerId": "L5", "fieldName": "games" },
      "L5_S5_F4": { "type": "free", "text": "Soft minimal, warm colors, tidy notes, gentle contrast, and intentional small details.", "sectionId": "L5_S5", "layerId": "L5", "fieldName": "aesthetic_style" },
      "L6_S1_F1": { "type": "free", "text": "No major physical limitations known.", "sectionId": "L6_S1", "layerId": "L6", "fieldName": "physical_incapability" },
      "L6_S1_F2": { "type": "free", "text": "Public confrontation, chaotic late-night settings, and activities that make private feelings performative.", "sectionId": "L6_S1", "layerId": "L6", "fieldName": "hard_no_activities" },
      "L6_S1_F3": { "type": "free", "text": "She does not want to pressure someone into commitment, ignore her own need for clarity, or turn care into a demand.", "sectionId": "L6_S1", "layerId": "L6", "fieldName": "absolute_boundaries" },
      "L6_S2_F1": { "type": "free", "text": "Noodle soups, sushi, matcha desserts, fruit teas, and quiet brunch spots.", "sectionId": "L6_S2", "layerId": "L6", "fieldName": "favorite_dishes" },
      "L6_S2_F2": { "type": "free", "text": "Soft green, cream, blush pink, warm gray, and muted blue.", "sectionId": "L6_S2", "layerId": "L6", "fieldName": "favorite_colors" },
      "L6_S2_F3": { "type": "free", "text": "Coffee walks, museum visits, study dates, bookstore browsing, and quiet conversations after dinner.", "sectionId": "L6_S2", "layerId": "L6", "fieldName": "preferred_activities" },
      "L6_S3_F1": { "type": "free", "text": "Mixed signals, dismissive humor, being rushed to decide, public emotional pressure, and vague answers after vulnerable moments.", "sectionId": "L6_S3", "layerId": "L6", "fieldName": "extreme_dislikes" },
      "L6_S3_F2": { "type": "free", "text": "Sincerity, emotional consistency, clear follow-through, warm humor, and people who make room for honest conversation.", "sectionId": "L6_S3", "layerId": "L6", "fieldName": "strong_likes" },
      "extra_time_life": { "type": "free", "text": MAYA_DEMO_EXTRAS["time-life"], "layerId": "EXTRA", "fieldName": "extra_time_life" },
      "extra_current_context": { "type": "free", "text": MAYA_DEMO_EXTRAS["current-context"], "layerId": "EXTRA", "fieldName": "extra_current_context" },
      "extra_stressors": { "type": "free", "text": MAYA_DEMO_EXTRAS.stressors, "layerId": "EXTRA", "fieldName": "extra_stressors" },
      "extra_cultural_moment": { "type": "free", "text": MAYA_DEMO_EXTRAS["cultural-moment"], "layerId": "EXTRA", "fieldName": "extra_cultural_moment" },
      "extra_relationship_role": { "type": "free", "text": MAYA_DEMO_EXTRAS["relationship-role"], "layerId": "EXTRA", "fieldName": "extra_relationship_role" }
    });

    return answers;
  }

  function buildAaronDemoAnswers() {
    const answers = clone(DANIEL_DEMO_ANSWERS);
    const axisBlueprint = {
      L1_A1: [0.75, 0.75, 1],
      L1_A2: [1, 0.75, 0.75],
      L1_A3: [0.25, 0.25, 0.5],
      L1_A4: [0.25, 0.25, 0.25],
      L1_A5: [0.25, 0.5, 0.25],
      L1_A6: [0.5, 0.75, 0.75],
      L2_A1: [0.75, 0.75, 0.5],
      L2_A2: [0.75, 1, 0.75],
      L2_A3: [1, 0.75, 0.75],
      L2_A4: [0.25, 0.5, 0.25],
      L2_A5: [0.75, 0.75, 0.5],
      L2_A6: [0.75, 1, 0.75],
      L3_A1: [1, 0.75, 0.75],
      L3_A2: [1, 1, 0.75],
      L3_A3: [0.75, 0.75, 0.75],
      L3_A4: [0.5, 0.5, 0.5],
      L3_A5: [0.75, 0.75, 1],
      L3_A6: [0.5, 0.75, 0.5]
    };

    Object.entries(answers).forEach(([questionId, answer]) => {
      if (!answer || typeof answer !== 'object' || typeof answer.value !== 'number' || !answer.axisId) return;
      const blueprint = axisBlueprint[answer.axisId];
      if (!blueprint) return;
      const qIndex = Math.max(0, Math.min(2, Number((questionId.match(/_Q(\d+)$/) || [])[1] || 1) - 1));
      const value = blueprint[qIndex];
      answer.type = 'choice';
      answer.value = value;
      answer.option = valueToOption(value);
      answer.confidence = answer.layerId === 'L3' ? 5 : 4;
    });

    Object.assign(answers, {
      "L4_A1_Q1": { "type": "multi", "selected": ["Warm", "Protective", "Practical"], "axisId": "L4_A1", "layerId": "L4" },
      "L4_A1_Q2": { "type": "multi", "selected": ["Calm", "Concerned", "Family-centered"], "axisId": "L4_A1", "layerId": "L4" },
      "L4_A1_Q3": { "type": "multi", "selected": ["Measured", "Loving", "Reserved"], "axisId": "L4_A1", "layerId": "L4" },
      "L4_A2_Q1": { "type": "multi", "selected": ["Caring", "Steady", "Responsible"], "axisId": "L4_A2", "layerId": "L4" },
      "L4_A2_Q2": { "type": "multi", "selected": ["Supportive", "Direct", "Patient"], "axisId": "L4_A2", "layerId": "L4" },
      "L4_A2_Q3": { "type": "multi", "selected": ["Warm", "Grounded", "Protective"], "axisId": "L4_A2", "layerId": "L4" },
      "L4_A3_Q1": { "type": "multi", "selected": ["Honest", "Plainspoken", "Careful"], "axisId": "L4_A3", "layerId": "L4" },
      "L4_A3_Q2": { "type": "multi", "selected": ["Clear", "Practical", "Respectful"], "axisId": "L4_A3", "layerId": "L4" },
      "L4_A3_Q3": { "type": "multi", "selected": ["Direct", "Gentle", "Responsible"], "axisId": "L4_A3", "layerId": "L4" },
      "L4_A4_Q1": { "type": "multi", "selected": ["Composed", "Quiet", "Watchful"], "axisId": "L4_A4", "layerId": "L4" },
      "L4_A4_Q2": { "type": "multi", "selected": ["Attentive", "Engaged", "Steady"], "axisId": "L4_A4", "layerId": "L4" },
      "L4_A4_Q3": { "type": "multi", "selected": ["Calm", "Protective", "Focused"], "axisId": "L4_A4", "layerId": "L4" },
      "L4_A5_Q1": { "type": "multi", "selected": ["Composed", "Concerned", "Loyal"], "axisId": "L4_A5", "layerId": "L4" },
      "L4_A5_Q2": { "type": "multi", "selected": ["Reserved", "Reflective", "Practical"], "axisId": "L4_A5", "layerId": "L4" },
      "L4_A5_Q3": { "type": "multi", "selected": ["Guarded", "Tender", "Protective"], "axisId": "L4_A5", "layerId": "L4" },
      "L4_A6_Q1": { "type": "multi", "selected": ["Simple", "Family-oriented", "Low-key"], "axisId": "L4_A6", "layerId": "L4" },
      "L4_A6_Q2": { "type": "multi", "selected": ["Polite", "Warm", "Observant"], "axisId": "L4_A6", "layerId": "L4" },
      "L4_A6_Q3": { "type": "multi", "selected": ["Mature", "Direct", "Dependable"], "axisId": "L4_A6", "layerId": "L4" },
      "L5_S1_F1": { "type": "free", "text": "Chinese-Vietnamese American.", "sectionId": "L5_S1", "layerId": "L5", "fieldName": "race" },
      "L5_S1_F2": { "type": "free", "text": "English and Vietnamese, with some Cantonese family phrases.", "sectionId": "L5_S1", "layerId": "L5", "fieldName": "languages" },
      "L5_S1_F3": { "type": "free", "text": "Respectful of family traditions, ancestral remembrance, and practical moral responsibility.", "sectionId": "L5_S1", "layerId": "L5", "fieldName": "religion" },
      "L5_S2_F1": { "type": "free", "text": "Operations manager at a regional logistics company.", "sectionId": "L5_S2", "layerId": "L5", "fieldName": "current_status" },
      "L5_S2_F2": { "type": "free", "text": "Community college background with years of practical work experience.", "sectionId": "L5_S2", "layerId": "L5", "fieldName": "school_university" },
      "L5_S2_F3": { "type": "free", "text": "He wants Maya to be safe, steady, educated, and confident enough to build a good life without feeling alone.", "sectionId": "L5_S2", "layerId": "L5", "fieldName": "aspirations" },
      "L5_S3_F1": { "type": "free", "text": "Family network, work colleagues, neighborhood friends, and relatives who gather around meals and practical support.", "sectionId": "L5_S3", "layerId": "L5", "fieldName": "communities" },
      "L5_S3_F2": { "type": "free", "text": "Prefers home dinners, quiet conversations, family errands, and settings where people can talk without performing.", "sectionId": "L5_S3", "layerId": "L5", "fieldName": "environment_style" },
      "L5_S4_F1": { "type": "free", "text": "Cooking, gardening, home repairs, classic films, fishing trips, and early morning walks.", "sectionId": "L5_S4", "layerId": "L5", "fieldName": "hobbies" },
      "L5_S4_F2": { "type": "free", "text": "Very invested when the activity supports family, steadiness, or a practical sense of care.", "sectionId": "L5_S4", "layerId": "L5", "fieldName": "engagement_level" },
      "L5_S5_F1": { "type": "free", "text": "Old love songs, Vietnamese ballads, classic rock, and quiet instrumental music while cooking.", "sectionId": "L5_S5", "layerId": "L5", "fieldName": "music" },
      "L5_S5_F2": { "type": "free", "text": "Family dramas, history documentaries, classic action films, and calm weekend cooking shows.", "sectionId": "L5_S5", "layerId": "L5", "fieldName": "shows_movies" },
      "L5_S5_F3": { "type": "free", "text": "Card games with family, chess on quiet evenings, and simple mobile puzzle games.", "sectionId": "L5_S5", "layerId": "L5", "fieldName": "games" },
      "L5_S5_F4": { "type": "free", "text": "Practical, tidy, warm wood tones, family photos, comfortable clothes, and well-kept tools.", "sectionId": "L5_S5", "layerId": "L5", "fieldName": "aesthetic_style" },
      "L6_S1_F1": { "type": "free", "text": "Mild knee stiffness after long workdays, but generally active and independent.", "sectionId": "L6_S1", "layerId": "L6", "fieldName": "physical_incapability" },
      "L6_S1_F2": { "type": "free", "text": "Chaotic parties, public confrontation, careless spending, and last-minute risky decisions.", "sectionId": "L6_S1", "layerId": "L6", "fieldName": "hard_no_activities" },
      "L6_S1_F3": { "type": "free", "text": "He does not respond well to being kept in the dark, being publicly embarrassed, or hearing major news without enough context.", "sectionId": "L6_S1", "layerId": "L6", "fieldName": "absolute_boundaries" },
      "L6_S2_F1": { "type": "free", "text": "Pho, grilled fish, roasted chicken, fresh fruit, strong coffee, and simple birthday cake with family.", "sectionId": "L6_S2", "layerId": "L6", "fieldName": "favorite_dishes" },
      "L6_S2_F2": { "type": "free", "text": "Deep green, navy, warm brown, cream, and charcoal.", "sectionId": "L6_S2", "layerId": "L6", "fieldName": "favorite_colors" },
      "L6_S2_F3": { "type": "free", "text": "Family dinners, home projects, quiet drives, market trips, and one-on-one talks while doing practical tasks.", "sectionId": "L6_S2", "layerId": "L6", "fieldName": "preferred_activities" },
      "L6_S3_F1": { "type": "free", "text": "Careless choices, vague explanations, public family conflict, wastefulness, and avoiding hard conversations until they become urgent.", "sectionId": "L6_S3", "layerId": "L6", "fieldName": "extreme_dislikes" },
      "L6_S3_F2": { "type": "free", "text": "Responsibility, honesty, family meals, steady planning, practical care, and being trusted enough to hear the truth.", "sectionId": "L6_S3", "layerId": "L6", "fieldName": "strong_likes" },
      "extra_time_life": { "type": "free", "text": AARON_DEMO_EXTRAS["time-life"], "layerId": "EXTRA", "fieldName": "extra_time_life" },
      "extra_current_context": { "type": "free", "text": AARON_DEMO_EXTRAS["current-context"], "layerId": "EXTRA", "fieldName": "extra_current_context" },
      "extra_stressors": { "type": "free", "text": AARON_DEMO_EXTRAS.stressors, "layerId": "EXTRA", "fieldName": "extra_stressors" },
      "extra_cultural_moment": { "type": "free", "text": AARON_DEMO_EXTRAS["cultural-moment"], "layerId": "EXTRA", "fieldName": "extra_cultural_moment" },
      "extra_relationship_role": { "type": "free", "text": AARON_DEMO_EXTRAS["relationship-role"], "layerId": "EXTRA", "fieldName": "extra_relationship_role" }
    });

    return answers;
  }

  function buildNaomiDemoAnswers() {
    const answers = clone(DANIEL_DEMO_ANSWERS);
    const axisBlueprint = {
      L1_A1: [0.75, 1, 0.75],
      L1_A2: [0.75, 0.75, 1],
      L1_A3: [0.5, 0.5, 0.75],
      L1_A4: [0.25, 0.5, 0.5],
      L1_A5: [0.5, 0.75, 0.75],
      L1_A6: [0.75, 0.75, 1],
      L2_A1: [0.75, 1, 0.75],
      L2_A2: [1, 0.75, 0.75],
      L2_A3: [0.75, 0.75, 1],
      L2_A4: [0.5, 0.5, 0.75],
      L2_A5: [0.75, 0.75, 0.5],
      L2_A6: [1, 0.75, 1],
      L3_A1: [0.75, 1, 1],
      L3_A2: [1, 0.75, 1],
      L3_A3: [0.75, 1, 0.75],
      L3_A4: [0.75, 0.75, 0.5],
      L3_A5: [0.75, 1, 1],
      L3_A6: [0.5, 0.75, 0.75]
    };

    Object.entries(answers).forEach(([questionId, answer]) => {
      if (!answer || typeof answer !== 'object' || typeof answer.value !== 'number' || !answer.axisId) return;
      const blueprint = axisBlueprint[answer.axisId];
      if (!blueprint) return;
      const qIndex = Math.max(0, Math.min(2, Number((questionId.match(/_Q(\d+)$/) || [])[1] || 1) - 1));
      const value = blueprint[qIndex];
      answer.type = 'choice';
      answer.value = value;
      answer.option = valueToOption(value);
      answer.confidence = answer.layerId === 'L3' ? 5 : 4;
    });

    Object.assign(answers, {
      "L4_A1_Q1": { "type": "multi", "selected": ["Professional", "Direct", "Calm"], "axisId": "L4_A1", "layerId": "L4" },
      "L4_A1_Q2": { "type": "multi", "selected": ["Focused", "Prepared", "Practical"], "axisId": "L4_A1", "layerId": "L4" },
      "L4_A1_Q3": { "type": "multi", "selected": ["Composed", "Fair", "Efficient"], "axisId": "L4_A1", "layerId": "L4" },
      "L4_A2_Q1": { "type": "multi", "selected": ["Supportive", "Clear", "Measured"], "axisId": "L4_A2", "layerId": "L4" },
      "L4_A2_Q2": { "type": "multi", "selected": ["Respectful", "Accountable", "Constructive"], "axisId": "L4_A2", "layerId": "L4" },
      "L4_A2_Q3": { "type": "multi", "selected": ["Firm", "Helpful", "Growth-minded"], "axisId": "L4_A2", "layerId": "L4" },
      "L4_A3_Q1": { "type": "multi", "selected": ["Evidence-based", "Concise", "Diplomatic"], "axisId": "L4_A3", "layerId": "L4" },
      "L4_A3_Q2": { "type": "multi", "selected": ["Specific", "Plainspoken", "Action-oriented"], "axisId": "L4_A3", "layerId": "L4" },
      "L4_A3_Q3": { "type": "multi", "selected": ["Direct", "Polite", "Solution-focused"], "axisId": "L4_A3", "layerId": "L4" },
      "L5_S1_F1": { "type": "free", "text": "Black American professional woman in a Bay Area strategy team.", "sectionId": "L5_S1", "layerId": "L5", "fieldName": "race" },
      "L5_S1_F2": { "type": "free", "text": "English primarily, with a polished and concise workplace communication style.", "sectionId": "L5_S1", "layerId": "L5", "fieldName": "languages" },
      "L5_S1_F3": { "type": "free", "text": "Values fairness, responsibility, and practical kindness more than performative agreement.", "sectionId": "L5_S1", "layerId": "L5", "fieldName": "religion" },
      "L5_S2_F1": { "type": "free", "text": "Strategy lead and Maya Chen's direct manager.", "sectionId": "L5_S2", "layerId": "L5", "fieldName": "current_status" },
      "L5_S2_F2": { "type": "free", "text": "Business and communications background with years of team leadership experience.", "sectionId": "L5_S2", "layerId": "L5", "fieldName": "school_university" },
      "L5_S2_F3": { "type": "free", "text": "Wants her team to do high-quality work, communicate early, and grow without avoidable drama.", "sectionId": "L5_S2", "layerId": "L5", "fieldName": "aspirations" },
      "L6_S1_F3": { "type": "free", "text": "She does not respond well to vague requests, hidden mistakes, or last-minute asks that ignore team impact.", "sectionId": "L6_S1", "layerId": "L6", "fieldName": "absolute_boundaries" },
      "L6_S3_F1": { "type": "free", "text": "Excuses without ownership, unclear priorities, missed deadlines, and requests that skip practical context.", "sectionId": "L6_S3", "layerId": "L6", "fieldName": "extreme_dislikes" },
      "L6_S3_F2": { "type": "free", "text": "Preparation, accountability, concise updates, thoughtful tradeoffs, and people who solve problems early.", "sectionId": "L6_S3", "layerId": "L6", "fieldName": "strong_likes" },
      "extra_time_life": { "type": "free", "text": NAOMI_DEMO_EXTRAS["time-life"], "layerId": "EXTRA", "fieldName": "extra_time_life" },
      "extra_current_context": { "type": "free", "text": NAOMI_DEMO_EXTRAS["current-context"], "layerId": "EXTRA", "fieldName": "extra_current_context" },
      "extra_stressors": { "type": "free", "text": NAOMI_DEMO_EXTRAS.stressors, "layerId": "EXTRA", "fieldName": "extra_stressors" },
      "extra_cultural_moment": { "type": "free", "text": NAOMI_DEMO_EXTRAS["cultural-moment"], "layerId": "EXTRA", "fieldName": "extra_cultural_moment" },
      "extra_relationship_role": { "type": "free", "text": NAOMI_DEMO_EXTRAS["relationship-role"], "layerId": "EXTRA", "fieldName": "extra_relationship_role" }
    });

    return answers;
  }

  function buildIdentityLayersFromAnswers(answers) {
    const buckets = { L1: {}, L2: {}, L3: {} };
    Object.values(answers).forEach((answer) => {
      if (!answer || !answer.axisId || !answer.layerId || !buckets[answer.layerId]) return;
      if (typeof answer.value !== 'number') return;
      const confidence = Math.max(1, Math.min(5, Number(answer.confidence) || 3)) / 5;
      if (!buckets[answer.layerId][answer.axisId]) buckets[answer.layerId][answer.axisId] = [];
      buckets[answer.layerId][answer.axisId].push({
        value: Math.max(0, Math.min(1, answer.value)),
        confidence
      });
    });

    const identityLayers = {};
    ['L1', 'L2', 'L3'].forEach((layerId) => {
      const result = {};
      Object.entries(buckets[layerId]).forEach(([axisId, values]) => {
        if (!values.length) return;
        const weightedValue = values.reduce((sum, item) => sum + item.value * item.confidence, 0);
        const confidenceMass = values.reduce((sum, item) => sum + item.confidence, 0) || values.length;
        const avg = weightedValue / confidenceMass;
        const avgConfidence = values.reduce((sum, item) => sum + item.confidence, 0) / values.length;
        result[axisId] = {
          value: Number(avg.toFixed(4)),
          confidence: Number(avgConfidence.toFixed(4))
        };
      });
      identityLayers[layerId] = JSON.stringify(result);
    });

    return identityLayers;
  }

  function buildDanielDemoPersonaState(options = {}) {
    const answers = clone(DANIEL_DEMO_ANSWERS);
    return {
      version: 1,
      savedAt: options.savedAt || '2026-07-06T00:00:00.000Z',
      personaName: 'Daniel Smith',
      personaPortrait: Object.prototype.hasOwnProperty.call(options, 'portraitDataUrl') ? options.portraitDataUrl : 'assets/daniel-smith-avatar.png',
      personaAvatarPresent: Object.prototype.hasOwnProperty.call(options, 'portraitDataUrl') ? (options.portraitDataUrl ? 'yes' : '') : 'yes',
      answers,
      session: {
        visibleIds: Object.keys(answers),
        currentIndex: 0
      },
      usersInput: 'Daniel Smith is a 23-year-old graduate student in product design. He is warm, thoughtful, and open to sincere conversation when it is framed gently. He values emotional honesty, independence, and steady pacing, but can become quiet if a conversation feels rushed or too emotionally loaded at the wrong time.',
      identityLayers: buildIdentityLayersFromAnswers(answers),
      extras: clone(DANIEL_DEMO_EXTRAS)
    };
  }

  const MAYA_DEMO_ANSWERS = buildMayaDemoAnswers();
  const AARON_DEMO_ANSWERS = buildAaronDemoAnswers();
  const NAOMI_DEMO_ANSWERS = buildNaomiDemoAnswers();

  function buildMayaDemoPersonaState(options = {}) {
    const answers = clone(MAYA_DEMO_ANSWERS);
    return {
      version: 1,
      savedAt: options.savedAt || '2026-07-06T00:00:00.000Z',
      personaName: 'Maya Chen',
      personaPortrait: Object.prototype.hasOwnProperty.call(options, 'portraitDataUrl') ? options.portraitDataUrl : 'assets/maya-chen-avatar.png',
      personaAvatarPresent: Object.prototype.hasOwnProperty.call(options, 'portraitDataUrl') ? (options.portraitDataUrl ? 'yes' : '') : 'yes',
      answers,
      session: {
        visibleIds: Object.keys(answers),
        currentIndex: 0
      },
      usersInput: 'Maya Chen is a 22-year-old student in San Francisco. She is thoughtful, observant, warm, and careful with emotionally important conversations. She wants clarity in her relationship with Daniel Smith, but she wants her message to feel sincere and low-pressure rather than anxious or demanding.',
      identityLayers: buildIdentityLayersFromAnswers(answers),
      extras: clone(MAYA_DEMO_EXTRAS)
    };
  }

  function buildAaronDemoPersonaState(options = {}) {
    const answers = clone(AARON_DEMO_ANSWERS);
    return {
      version: 1,
      savedAt: options.savedAt || '2026-07-06T00:00:00.000Z',
      personaName: 'Aaron Chen',
      personaPortrait: Object.prototype.hasOwnProperty.call(options, 'portraitDataUrl') ? options.portraitDataUrl : 'assets/aaron-chen-avatar.svg',
      personaAvatarPresent: Object.prototype.hasOwnProperty.call(options, 'portraitDataUrl') ? (options.portraitDataUrl ? 'yes' : '') : 'yes',
      answers,
      session: {
        visibleIds: Object.keys(answers),
        currentIndex: 0
      },
      usersInput: 'Aaron Chen is Maya Chen\'s father. He is protective, practical, warm in a quiet way, and most receptive when serious family news is shared with respect, context, and a realistic plan. He may worry quickly when information arrives suddenly, but he becomes supportive when Maya helps him understand how he can be present for her.',
      identityLayers: buildIdentityLayersFromAnswers(answers),
      extras: clone(AARON_DEMO_EXTRAS)
    };
  }

  function buildNaomiDemoPersonaState(options = {}) {
    const answers = clone(NAOMI_DEMO_ANSWERS);
    return {
      version: 1,
      savedAt: options.savedAt || '2026-07-06T00:00:00.000Z',
      personaName: 'Naomi Brooks',
      personaPortrait: Object.prototype.hasOwnProperty.call(options, 'portraitDataUrl') ? options.portraitDataUrl : 'assets/naomi-brooks-avatar.svg',
      personaAvatarPresent: Object.prototype.hasOwnProperty.call(options, 'portraitDataUrl') ? (options.portraitDataUrl ? 'yes' : '') : 'yes',
      answers,
      session: {
        visibleIds: Object.keys(answers),
        currentIndex: 0
      },
      usersInput: 'Naomi Brooks is Maya Chen\'s direct manager. She is fair, direct, deadline-aware, and supportive when requests are prepared with context and accountability. She responds best to concise evidence, practical tradeoffs, and clear next steps that protect both the person and the team.',
      identityLayers: buildIdentityLayersFromAnswers(answers),
      extras: clone(NAOMI_DEMO_EXTRAS)
    };
  }

  const DEMO_PERSONA_DEFINITIONS = {
    'daniel-smith-demo': {
      key: 'daniel-smith-demo',
      name: 'Daniel Smith',
      title: 'Daniel Smith Persona - Syntrae Demo',
      editTitle: 'Edit Daniel Smith Persona - Syntrae Demo',
      portrait: 'assets/daniel-smith-avatar.png',
      chips: ['Graduate student', 'Male', '23 yrs old'],
      buildState: buildDanielDemoPersonaState
    },
    'maya-chen-demo': {
      key: 'maya-chen-demo',
      name: 'Maya Chen',
      title: 'Maya Chen Persona - Syntrae Demo',
      editTitle: 'Edit Maya Chen Persona - Syntrae Demo',
      portrait: 'assets/maya-chen-avatar.png',
      chips: ['Student', 'Female', '22 yrs old'],
      buildState: buildMayaDemoPersonaState
    },
    'aaron-chen-demo': {
      key: 'aaron-chen-demo',
      name: 'Aaron Chen',
      title: 'Aaron Chen Persona - Syntrae Demo',
      editTitle: 'Edit Aaron Chen Persona - Syntrae Demo',
      portrait: 'assets/aaron-chen-avatar.svg',
      chips: ['Maya\'s dad', 'Male', '55 yrs old'],
      buildState: buildAaronDemoPersonaState
    },
    'naomi-brooks-demo': {
      key: 'naomi-brooks-demo',
      name: 'Naomi Brooks',
      title: 'Naomi Brooks Persona - Syntrae Demo',
      editTitle: 'Edit Naomi Brooks Persona - Syntrae Demo',
      portrait: 'assets/naomi-brooks-avatar.svg',
      chips: ['Maya\'s boss', 'Team lead', '39 yrs old'],
      buildState: buildNaomiDemoPersonaState
    }
  };

  function getDemoPersonaDefinition(key) {
    return DEMO_PERSONA_DEFINITIONS[key] || DEMO_PERSONA_DEFINITIONS['daniel-smith-demo'];
  }

  window.DANIEL_DEMO_ANSWERS = DANIEL_DEMO_ANSWERS;
  window.MAYA_DEMO_ANSWERS = MAYA_DEMO_ANSWERS;
  window.AARON_DEMO_ANSWERS = AARON_DEMO_ANSWERS;
  window.NAOMI_DEMO_ANSWERS = NAOMI_DEMO_ANSWERS;
  window.buildDanielDemoPersonaState = buildDanielDemoPersonaState;
  window.buildMayaDemoPersonaState = buildMayaDemoPersonaState;
  window.buildAaronDemoPersonaState = buildAaronDemoPersonaState;
  window.buildNaomiDemoPersonaState = buildNaomiDemoPersonaState;
  window.SYNTRAE_DEMO_PERSONAS = DEMO_PERSONA_DEFINITIONS;
  window.getDemoPersonaDefinition = getDemoPersonaDefinition;
})();
