use llama_cpp::{standard_sampler::StandardSampler, LlamaModel, SessionParams};

use crate::history::{self, History};

const DEFAULT_MAX_TOKENS: usize = 128;

#[derive(Debug)]
pub struct Options {
    pub setup: Option<String>,
    pub prompt: String,
    pub max_tokens: Option<usize>,
}

pub fn generate_text(
    model: &LlamaModel,
    history: &mut History,
    opts: impl Into<Options>,
) -> Result<String, Box<dyn std::error::Error>> {
    let Options {
        setup,
        prompt,
        max_tokens,
    } = opts.into();

    let mut ctx = model.create_session(SessionParams {
        n_threads: 1,
        ..Default::default()
    })?;

    history.push(history::MessageType::User, prompt);
    ctx.advance_context(match setup {
        Some(v) => history.get_with_system(v),
        None => history.get(),
    })?;

    let completions = ctx
        .start_completing_with(
            StandardSampler::default(),
            max_tokens.unwrap_or(DEFAULT_MAX_TOKENS),
        )?
        .into_string();

    Ok(completions)
}
