import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Loan } from '../../../domain/loan.js';
import { BorrowUseCase } from '../../../application/borrow/borrow.usecase.js';
import { ReturnUseCase } from '../../../application/return/return.usecase.js';
import { ApiRefusals } from '../errors/documented-refusals.js';
import { BorrowBody, ReturnBody } from './circulation.dto.js';

/**
 * Ce qu'une opération rend au guichet.
 */
interface LoanView {
  /** L'exemplaire concerné. */
  copyId: string;
  /** L'adhérent concerné. */
  memberId: string;
  /** L'échéance du prêt. */
  dueAt: string;
}

/**
 * Rend un prêt lisible par un client HTTP.
 *
 * @param loan - le prêt du domaine
 * @returns sa représentation
 */
function viewOf(loan: Loan): LoanView {
  return {
    copyId: loan.copyId,
    memberId: loan.memberId,
    dueAt: loan.dueAt.toISOString(),
  };
}

/**
 * Les deux opérations du guichet : emprunter et rendre.
 *
 * Une opération métier, une route. Le contrôleur valide, appelle, et traduit ;
 * il ne décide rien. Les refus remontent tels quels et c'est `RefusalFilter`
 * qui leur donne un code, ce qui garde la correspondance en un seul endroit.
 */
@ApiTags('circulation')
@Controller()
export class CirculationController {
  /**
   * @param borrow - le cas d'usage d'emprunt
   * @param give - le cas d'usage de retour
   */
  constructor(
    private readonly borrow: BorrowUseCase,
    private readonly give: ReturnUseCase,
  ) {}

  /**
   * Prête un exemplaire à un adhérent.
   *
   * @param body - l'exemplaire et l'adhérent
   * @returns le prêt créé
   */
  @Post('loans')
  @ApiOperation({ summary: 'Prêter un exemplaire à un adhérent' })
  @ApiResponse({ status: 201, description: 'Le prêt créé, avec son échéance' })
  @ApiRefusals(
    'CopyAlreadyOnLoan',
    'CopySetAsideForAnother',
    'BlockedByDebt',
    'MembershipExpired',
    'BorrowCeilingReached',
    'UnknownParty',
  )
  async lend(@Body() body: BorrowBody): Promise<LoanView> {
    const loan = await this.borrow.execute({
      copyId: body.copyId,
      memberId: body.memberId,
      now: new Date(),
    });
    return viewOf(loan);
  }

  /**
   * Rend un exemplaire.
   *
   * @param body - l'exemplaire rendu
   * @returns la dette constatée et l'adhérent servi le cas échéant
   */
  @Post('returns')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rendre un exemplaire et constater la dette' })
  @ApiResponse({
    status: 200,
    description: 'La dette constatée et l adhérent servi le cas échéant',
  })
  @ApiRefusals('CopyNotOnLoan')
  async take(
    @Body() body: ReturnBody,
  ): Promise<{ debt: number; setAsideFor: string | null }> {
    const outcome = await this.give.execute({
      copyId: body.copyId,
      now: new Date(),
    });
    return { debt: outcome.debt, setAsideFor: outcome.setAsideFor };
  }
}
