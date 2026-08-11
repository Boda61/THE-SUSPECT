export const CASES = [
  {
    id: 'case-coffee',
    secret_word: 'القهوة',
    title: 'سر لغز المشروب السحري',
    description: 'شيء يومي مرتبط بالمزاج والتركيز، في ناس مبتعرفش تبدأ يومها من غيره ونسبة كبيرة من الشعب بتعشقه.',
    difficulty: 'متوسط',
    locations: [
      { id: 'loc-kitchen', name: 'المطبخ', icon: '🍳', description: 'في أركان المطبخ أسرار كتير... فتش هنا.' },
      { id: 'loc-cafe', name: 'الكافيه', icon: '☕', description: 'مكان تجمع العشاق والأسرار، افتشه بعناية.' },
      { id: 'loc-market', name: 'السوق', icon: '🛒', description: 'من هنا بتبدأ القصة، الرائحة بتنتشر في كل مكان.' },
      { id: 'loc-office', name: 'مكان العمل', icon: '🏢', description: 'البيئة اللي مفيش محد بيشتغل من غيرها بجد.' },
    ],
    clues: [
      { id: 'c1', title: 'دليل الصحيان', text: 'في ناس مبتقدرش تفتح عينها ولا تبدأ يومها من غير ما تشربها.', difficulty: 'easy', category: 'عادات يومية', location_id: 'loc-kitchen' },
      { id: 'c2', title: 'دليل الرائحة', text: 'ريحتها لوحدها في المكان ممكن تفوّق أي حد نايم.', difficulty: 'easy', category: 'الحياة اليومية', location_id: 'loc-kitchen' },
      { id: 'c3', title: 'دليل الكافيه', text: 'مرتبطة دايماً بالقعدة الحلوة، الكلام الكتير، والمذاكرة أيام الامتحانات.', difficulty: 'easy', category: 'مواقف اجتماعية', location_id: 'loc-cafe' },
      { id: 'c4', title: 'دليل الطقوس', text: 'لو عملتها بوش مضبوط، بتعتبر نفسك عملت إنجاز عظيم.', difficulty: 'medium', category: 'طقوس مصرية', location_id: 'loc-kitchen', requires_puzzle: true, puzzle_id: 'puz-1' },
      { id: 'c5', title: 'دليل التفضيل', text: 'بتتطلب مضبوط، زيادة، أو سادة... وعلى حسب مزاج كل واحد.', difficulty: 'medium', category: 'تعبيرات شائعة', location_id: 'loc-market' },
      { id: 'c6', title: 'دليل الإدمان', text: 'بتلاقي واحد قاعد معاها في الكافيه أكتر ما بيقعد مع أهله في البيت.', difficulty: 'medium', category: 'الحياة اليومية', location_id: 'loc-cafe' },
      { id: 'c7', title: 'دليل المصيبة', text: 'لو نزلت نقطة منها على قميص أبيض قبل ما تنزل، يومك باظ رسمي 😂', difficulty: 'funny', category: 'مواقف مضحكة', location_id: 'loc-office' },
      { id: 'c8', title: 'دليل الأنواع', text: 'في منها أنواع غالية ومستوردة، وفي أنواع بنعملها في كنزة على الناشف.', difficulty: 'hard', category: 'ثقافة مصرية', location_id: 'loc-market' },
      { id: 'c9', title: 'دليل الثقافة', text: 'طريقتها بتفرق من بلد لبلد، بس عندنا هنا ليها طقوس محدش يفهمها غير عشاقها.', difficulty: 'hard', category: 'ثقافة مصرية', location_id: 'loc-cafe' },
      { id: 'c10', title: 'دليل السكر', text: 'لو طلبتها من غير سكر، غالبًا اللي قاعد معاك بيبصلك بصلة إنك شخص قاسي ومبتتحبش 😅', difficulty: 'funny', category: 'مواقف مضحكة', location_id: 'loc-office' },
    ],
    puzzles: [
      {
        id: 'puz-1',
        title: 'شفرة المطبخ السرية',
        hint: 'ده الشيء اللي بيحوّل الماء العادي لـ magic... اسمه في كلمة واحدة بالعربي (كلمة القضية نفسها)',
        answer: 'القهوة',
      },
    ],
    connections: [
      { id: 'conn-1', title: '🔗 ارتباط الرائحة بالصحيان', clue_ids: ['c1', 'c2'], description: 'الرائحة الطاغية هي السلاح السري اللي بيصحّي الناس كل يوم.' },
      { id: 'conn-2', title: '🔗 ارتباط الكافيه بالإدمان', clue_ids: ['c3', 'c6'], description: 'الكافيه هو المعبد الرسمي لعشاق هذا المشروب — مكان اللقاء والإدمان.' },
      { id: 'conn-3', title: '🔗 ارتباط الأنواع بالثقافة', clue_ids: ['c8', 'c9'], description: 'تنوع الأنواع والطرق يعكس ثقافة متجذرة وأصيلة لدى الشعب.' },
    ],
    interrogations: [
      {
        suspect_id: 'suspect-ahmed',
        suspect_name: 'أحمد — الموظف المتعب',
        statements: [
          'أنا بابدأ يومي بشرب حاجة دافية قبل ما أدخل الأوفيس خالص.',
          'مش ممكن أركز في الشغل من غير ما أكمل أول ساعة صح.',
          'مرتبطة ليا بورقة الصحف الصبح وأخبار البلد.',
        ],
        contradictions: [
          { id: 'contra-1', suspect_id: 'suspect-ahmed', description: 'قال إنه بيبدأ يومه قبل الأوفيس، لكن قبل كده قال مبيصحاش قبل الشغل بساعة!' },
        ],
      },
      {
        suspect_id: 'suspect-sara',
        suspect_name: 'سارة — طالبة الجامعة',
        statements: [
          'أنا بشرب الحاجة دي بس وقت الامتحانات عشان أذاكر بالليل.',
          'مبحبش الحاجات السكر أوي، بفضل الخفيف.',
          'صاحبتي بتجيبلي أحياناً من البرة بأنواع غريبة.',
        ],
        contradictions: [
          { id: 'contra-2', suspect_id: 'suspect-sara', description: 'قالت إنها بتشربها بس وقت الامتحانات، لكن الكافيه قالوا إنها زبون يومي منذ 6 أشهر!' },
        ],
      },
    ],
  },

  {
    id: 'case-phone',
    secret_word: 'الموبايل',
    title: 'اختفاء الجهاز الغامض',
    description: 'شيء صغير في حجم الكف، لكنه مسيطر على حياة الناس ومحدش بيقدر يستغنى عنه دقيقة واحدة.',
    difficulty: 'سهل',
    clues: [
      { id: 'c1', text: 'أول حاجة بتمسكها لما تصحى من النوم، وآخل حاجة بتشوفها قبل ما تنام.', difficulty: 'easy', category: 'عادات يومية' },
      { id: 'c2', text: 'لو ضاع منك في البيت على الوضع الصامت، بتعيش لحظات رعب حقيقية.', difficulty: 'easy', category: 'مواقف يومية' },
      { id: 'c3', text: 'الشاحن بتاعه بقى أهم من الأكل والشرب بالنسبة لناس كتير.', difficulty: 'easy', category: 'تكنولوجيا' },
      { id: 'c4', text: 'لو الشاشة بتاعته اتكسرت، بتحس إن جزء من روحك هو اللي اتكسر.', difficulty: 'medium', category: 'مواقف مضحكة' },
      { id: 'c5', text: 'المكان اللي بتقعد فيه جنب الفيشة بقى هو المكان المفضل في البيت.', difficulty: 'medium', category: 'عادات شعبية' },
      { id: 'c6', text: 'بنسجل عليه كل أسرارنا وصورنا، ولو حد مسكه مفتوح بنتوتر فوراً.', difficulty: 'medium', category: 'أسرار وحكايات' },
      { id: 'c7', text: 'لما البصمة مابتتعرفش على وشك وأنت لسه صاحي من النوم، بتحس بإهانة.', difficulty: 'funny', category: 'مواقف مضحكة' },
      { id: 'c8', text: 'زمان كان مجرد وسيلة للاتصال، دلوقتي بقى مفيش حاجة في يومك مابتتمش من خلاله.', difficulty: 'hard', category: 'تطور الزمن' },
      { id: 'c9', text: 'الناس بقت تقعد مع بعض في كافيه واحد وكل واحد باصص في شاشته الخاصة.', difficulty: 'hard', category: 'ملاحظات اجتماعية' },
      { id: 'c10', text: 'لو البطارية جابت 1% وأنت بره البيت، دقات قلبك بتزيد أسرع من الجري 🏃‍♂️', difficulty: 'funny', category: 'مواقف مضحكة' },
    ],
  },
  {
    id: 'case-microbus',
    secret_word: 'المواصلات العامة',
    title: 'رحلة البحث عن الكرسي الأخير',
    description: 'تجربة يومية يعيشها ملايين المصريين، مليانة أحداث ومواقف وحكايات لا تنتهي.',
    difficulty: 'متوسط',
    clues: [
      { id: 'c1', text: 'الكلمة الشائعة هنا هي: "اقفل الباب براحة" أو "على جنب يا كابتن".', difficulty: 'easy', category: 'تعبيرات عامية' },
      { id: 'c2', text: 'بتعدّي الفلوس للمحطة وتستنى الباقي يرجعلك من إيد لإيد.', difficulty: 'easy', category: 'مواقف شعبية' },
      { id: 'c3', text: 'أوقات بتسمع فيها أحدث أغاني التوك توك والمهرجانات بأعلى صوت.', difficulty: 'easy', category: 'ثقافة مصرية' },
      { id: 'c4', text: 'الكرسي اللي ورا السواق دايماً بيبقى صاحب المسؤولية الكبرى في جمع الأجرة.', difficulty: 'medium', category: 'مواقف مضحكة' },
      { id: 'c5', text: 'لو نزلت في ساعة الذروة، بتكتشف قدرات خارقة عندك في التزاحم والدخول.', difficulty: 'medium', category: 'روتين يومي' },
      { id: 'c6', text: 'ممكن تسمع فيها قصة حياة الشخص اللي قاعد جنبك من غير ما تسأله.', difficulty: 'medium', category: 'فضول واجتماعيات' },
      { id: 'c7', text: 'لو الكرسي الأخير فاضي، بتفكر 10 مرات قبل ما تقعد فيه من حركته.', difficulty: 'hard', category: 'خبرة الشارع' },
      { id: 'c8', text: 'السائق هو الحاكم الفعلي للرحلة، وهو اللي بحدد المزاج والسرعة والمزيكا.', difficulty: 'hard', category: 'شخصيات الشارع' },
      { id: 'c9', text: 'موقف "مفيش فكة" بيبدأ خناقة درامية لطيفة بين الناس.', difficulty: 'funny', category: 'مواقف مضحكة' },
      { id: 'c10', text: 'لو حد قال "واحد شغال"، اعرف إن الرحلة هتبدأ حالاً من غير انتظار.', difficulty: 'funny', category: 'مصطلحات الشارع' },
    ],
  },
  {
    id: 'case-summer',
    secret_word: 'الساحل والصيف',
    title: 'لغز المهرجان الصيفي',
    description: 'موسم ومكان مرتبط بالفرفشة، السفر، الزحمة، وتضييع الفلوس في أسرع وقت ممكن.',
    difficulty: 'صعب',
    clues: [
      { id: 'c1', text: 'كل الناس بتستناه طول السنة عشان تهرب من حر الصيف والروتين.', difficulty: 'easy', category: 'إجازات' },
      { id: 'c2', text: 'الشمس، البحر، والمايوه، مع ريحة صان بلوك في كل مكان.', difficulty: 'easy', category: 'أجواء صيفية' },
      { id: 'c3', text: 'المصاريف فيه بتطير بسرعة الصاروخ، وتراجع حساباتك البنكية بعد ما ترجع.', difficulty: 'medium', category: 'مواقف مضحكة' },
      { id: 'c4', text: 'تقسيمة شائعة بين الناس: يا إما طيب وأليف، يا إما شقاوة وزحمة ومحلات غالية.', difficulty: 'medium', category: 'تصنيفات مصرية' },
      { id: 'c5', text: 'السفرية دي بتتخطط في الجروب من 3 شهور، وفي الآخر نص الفريق بيلغي.', difficulty: 'medium', category: 'صحاب وإجازات' },
      { id: 'c6', text: 'الرجوع منه بيبقى محتاج إجازة ثانية عشان تظبط نومتك وتتعافى من التعب.', difficulty: 'hard', category: 'روتين الصيف' },
      { id: 'c7', text: 'كل واحد بيرجع منه بلون بشرة مختلف ونظارة شمس جديدة.', difficulty: 'easy', category: 'مظهر وخروج' },
      { id: 'c8', text: 'لو عملت حادثة بسيطة هناك، بتلاقي الأغاني شغالة بصوت عالي برضه.', difficulty: 'hard', category: 'أجواء شبابية' },
      { id: 'c9', text: 'الأسعار هناك بتخليك تتأكد إن الجنيه اتغيرت قيمته تماماً 😂', difficulty: 'funny', category: 'مواقف مضحكة' },
      { id: 'c10', text: 'كل الصور اللي بتنزل منه على الاستوري بتبقى برعايته وشعاره الصيفي.', difficulty: 'funny', category: 'سوشيال ميديا' },
    ],
  }
];

export const getRandomCase = () => {
  const index = Math.floor(Math.random() * CASES.length);
  return CASES[index];
};
